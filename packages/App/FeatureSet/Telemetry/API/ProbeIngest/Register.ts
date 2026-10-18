import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import {
  IsRegisterProbeKeyShipped,
  RegisterProbeKey,
  isShippedSecretValue,
} from "Common/Server/EnvironmentConfig";
import SecretKeyComparison from "Common/Server/Utils/SecretKeyComparison";
import ProbeService from "Common/Server/Services/ProbeService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";

const router: ExpressRouter = Express.getRouter();

/*
 * Said when the installation never set a real REGISTER_PROBE_KEY, so no global
 * probe may register. The value the repository ships is public, so accepting
 * it would let anyone register a global probe and read every project's
 * global-probe monitors — credentials included — or feed in fake results.
 */
export const REGISTRATION_DISABLED_MESSAGE: string =
  "Global probe registration is turned off on this installation because REGISTER_PROBE_KEY is unset or still a value shipped in the OneUptime repository. Set REGISTER_PROBE_KEY to a long random value on the OneUptime server, and give each global probe the same value, to register one.";

export const INVALID_REGISTER_PROBE_KEY_MESSAGE: string =
  "Invalid or missing registerProbeKey. Set REGISTER_PROBE_KEY to a long random value on the OneUptime server and give this probe the same value.";

export const SHIPPED_PROBE_KEY_MESSAGE: string =
  "The probe key is a value the OneUptime repository ships, which is public, so it is refused. Give this probe a long random PROBE_KEY (GLOBAL_PROBE_n_KEY in Docker Compose).";

// Register Global Probe. Custom Probe can be registered via dashboard.
router.post(
  "/register",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body;

      /*
       * No global probe registers against an installation that left
       * REGISTER_PROBE_KEY unset or at a value this repository ships: that
       * value is public, so it proves nothing.
       */
      if (IsRegisterProbeKeyShipped) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(REGISTRATION_DISABLED_MESSAGE),
        );
      }

      const registerProbeKey: string | undefined = data[
        "registerProbeKey"
      ] as string;

      /*
       * The presented key must be a real value and must equal this
       * installation's REGISTER_PROBE_KEY, compared in constant time so a
       * caller cannot recover it a character at a time.
       */
      if (
        !registerProbeKey ||
        isShippedSecretValue(registerProbeKey) ||
        !SecretKeyComparison.timingSafeEqual(
          registerProbeKey,
          RegisterProbeKey.toString(),
        )
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(INVALID_REGISTER_PROBE_KEY_MESSAGE),
        );
      }

      if (!data["probeKey"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeId or ProbeKey is missing"),
        );
      }

      const probeKey: string = data["probeKey"] as string;

      /*
       * A probe authenticates every later request with this key
       * (ProbeService.verifyProbeKey), so a value the repository ships is
       * refused here too: it would be a probe anyone could impersonate.
       */
      if (isShippedSecretValue(probeKey)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(SHIPPED_PROBE_KEY_MESSAGE),
        );
      }

      const probeName: string | undefined = data["probeName"] as string;
      const probeDescription: string | undefined = data[
        "probeDescription"
      ] as string;

      const probe: Probe | null = await ProbeService.findOneBy({
        query: {
          key: probeKey,
          isGlobalProbe: true,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (probe) {
        await ProbeService.updateOneById({
          id: probe.id!,
          data: {
            name: probeName,
            description: probeDescription,
            lastAlive: OneUptimeDate.getCurrentDate(),
            connectionStatus: ProbeConnectionStatus.Connected,
          },
          props: {
            isRoot: true,
          },
        });

        return Response.sendJsonObjectResponse(req, res, {
          _id: probe._id?.toString(),
          message: "Probe already registered",
        });
      }

      /*
       * The key does not match a global probe. A global probe is named
       * (GLOBAL_PROBE_n_NAME), and its key is its operator's to rotate — on
       * the Docker Compose and Helm installs the deployment tool gives every
       * global probe a fresh random key where it used to ship a placeholder,
       * so the same bundled probe comes back under a new key. Rekey the
       * existing global probe of this name rather than mint a second one, so
       * the monitors already assigned to it keep running under the same id.
       * Only when exactly one global probe has the name: zero means this is a
       * new probe, more than one is ambiguous and is left to create a new row.
       * The caller already proved it holds this installation's
       * REGISTER_PROBE_KEY, which is all it takes to administer global probes.
       */
      if (probeName) {
        const sameNamedGlobalProbes: Array<Probe> = await ProbeService.findBy({
          query: {
            name: probeName,
            isGlobalProbe: true,
          },
          select: {
            _id: true,
          },
          limit: 2,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        if (sameNamedGlobalProbes.length === 1) {
          const existingProbe: Probe = sameNamedGlobalProbes[0]!;

          await ProbeService.updateOneById({
            id: existingProbe.id!,
            data: {
              key: probeKey,
              description: probeDescription,
              lastAlive: OneUptimeDate.getCurrentDate(),
              connectionStatus: ProbeConnectionStatus.Connected,
            },
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            _id: existingProbe._id?.toString(),
            message: "Probe already registered",
          });
        }
      }

      let newProbe: Probe = new Probe();
      newProbe.isGlobalProbe = true;
      newProbe.key = probeKey;
      newProbe.name = probeName;
      newProbe.description = probeDescription;
      newProbe.lastAlive = OneUptimeDate.getCurrentDate();
      newProbe.connectionStatus = ProbeConnectionStatus.Connected;
      newProbe.shouldAutoEnableProbeOnNewMonitors = true;

      newProbe = await ProbeService.create({
        data: newProbe,
        props: {
          isRoot: true,
        },
      });

      return Response.sendJsonObjectResponse(req, res, {
        _id: newProbe._id?.toString(),
        message: "Probe registered successfully",
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
