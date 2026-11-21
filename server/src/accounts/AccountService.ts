import { createHmac } from "node:crypto";
import type { AccountRepository } from "./AccountRepository.js";

/** The phone asking: its account and its device token. */
export interface CurrentDevice {
  studentId: string;
  deviceToken: string;
}

export interface LinkResult {
  /** The account the phone uses now. */
  studentId: string;
  /** The phone's new device token when it switched accounts; null when it kept its own. */
  deviceToken: string | null;
  /** The phone's old unlinked account, deleted after its hand-added data moved. */
  removedStudentId: string | null;
  movedItems: number;
}

/** Cue accounts: a Canvas login decides which account a phone uses. */
export class AccountService {
  constructor(
    private readonly repo: AccountRepository,
    private readonly secretKey: Buffer,
  ) {}

  create(): { studentId: string; deviceToken: string } {
    return this.repo.create();
  }

  findByToken(deviceToken: string): string | null {
    return this.repo.findByToken(deviceToken);
  }

  delete(studentId: string): void {
    this.repo.delete(studentId);
  }

  isLinked(studentId: string): boolean {
    return this.repo.identityOf(studentId) != null;
  }

  /** A keyed hash: the database alone can't be matched against Canvas user IDs. */
  identityHash(canvasUrl: string, canvasUserId: string): string {
    return createHmac("sha256", this.secretKey).update(`${canvasUrl}|${canvasUserId}`).digest("hex");
  }

  /**
   * Puts the phone on the account of the Canvas user who logged in, in one transaction:
   * claims the phone's unlinked account, creates an account, or switches the phone to the
   * existing one (moving hand-added data from an unlinked account, which is then deleted).
   * `save` runs in the same transaction with the resulting account, to store the Canvas tokens.
   */
  link(
    current: CurrentDevice,
    identity: { canvasUrl: string; userId: string },
    save: (studentId: string) => void,
  ): LinkResult {
    const hash = this.identityHash(identity.canvasUrl, identity.userId);
    return this.repo.transaction(() => {
      const result = this.linkIdentity(current, hash);
      save(result.studentId);
      return result;
    });
  }

  private linkIdentity(current: CurrentDevice, hash: string): LinkResult {
    const owner = this.repo.findByIdentity(hash);
    const phoneIsLinked = this.isLinked(current.studentId);
    const stay = { studentId: current.studentId, deviceToken: null, removedStudentId: null, movedItems: 0 };

    // A reconnect: nothing changes.
    if (owner === current.studentId) return stay;
    // No account has this identity yet: the phone's unlinked account takes it.
    if (owner == null && !phoneIsLinked) {
      this.repo.setIdentity(current.studentId, hash);
      return stay;
    }

    // Every other case switches the phone to another account; it no longer holds its old token.
    const target = owner ?? this.repo.createLinked(hash);
    this.repo.removeDevice(current.deviceToken);
    const deviceToken = this.repo.addDevice(target);

    // Switch + move: the unlinked account's hand-added data goes to the existing account, then the account goes.
    if (owner != null && !phoneIsLinked) {
      const movedItems = this.repo.moveManualData(current.studentId, target);
      this.repo.delete(current.studentId);
      return { studentId: target, deviceToken, removedStudentId: current.studentId, movedItems };
    }
    // A new account, or a switch that leaves the phone's old (linked) account as it is, for its owner.
    return { studentId: target, deviceToken, removedStudentId: null, movedItems: 0 };
  }
}
