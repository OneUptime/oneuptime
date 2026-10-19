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
 * probe may register: a global probe runs the monitors of every project, so
 * only the installation's own key makes one, never a value the repository
 * ships.
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
       * (ProbeService.verifyProbeKey), which never accepts a value the
       * repository ships, so such a key is refused here too.
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
       * No global probe holds this key. A bundled probe that ran on the key
       * config.example.env ships comes back under the random one npm start
       * gave it (GLOBAL_PROBE_n_KEY), and the row it ran as is refused from
       * then on. It takes that row over - the global probe of its name whose
       * key is a value the repository ships - so it keeps its id, and the
       * monitors assigned to it keep running. A global probe whose key is
       * the installation's own is never taken over by its name: only its
       * key proves which probe it is (ShippedKeyTakeover).
       */
      if (typeof probeName === "string" && probeName.trim()) {
        const existingProbe: Probe | null =
          await ProbeService.findGlobalProbeToTakeOver({
            name: probeName,
            presentedKey: probeKey,
          });

        if (existingProbe) {
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
