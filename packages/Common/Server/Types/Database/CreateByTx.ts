import { EntityManager } from "typeorm";

/*
 * Server-only transaction context for a create whose row insert must join
 * a caller-owned transaction (HOM-43: the Discord note-save fence runs
 * hasNote+insert under one advisory xact lock). `manager` is the
 * transaction-scoped EntityManager the insert runs on. Effects queued
 * through `afterCommit` run only after the owning transaction commits and
 * are discarded on rollback — an in-memory queue is coordination, not an
 * at-least-once delivery guarantee, so the queue's owner surfaces a
 * committed-but-effects-failed outcome when a queued effect throws.
 */
export default interface CreateByTx {
  manager: EntityManager;
  afterCommit: (effect: () => Promise<void>) => void;
}
