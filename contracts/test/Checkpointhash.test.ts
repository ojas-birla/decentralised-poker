// SPEC-2.1 §7 C1: the TypeScript checkpoint hash/signature (shared/envelope.ts) must match the contract's own
// hashing, so a mismatch is caught now and not at 2.7.
import { expect } from "chai";
import { ethers } from "hardhat";
import { SigningKey, Wallet } from "ethers";
import type { TypedDataDomain } from "ethers";
import { CHECKPOINT_DOMAIN, checkpointHashFor } from "../../shared/envelope";
import type { Checkpoint } from "../../shared/types";

describe("checkpoint EIP-712: TypeScript vs contract", () => {
  const BUY_IN = 10n ** 15n; // divisible by 1000
  const WEI_PER_CHIP = BUY_IN / 1000n;

  async function setup() {
    const signers = await ethers.getSigners();
    const poker: any = await ethers.deployContract("DecentralisedPoker");
    const sessionKeys = [0, 1, 2, 3].map(() => Wallet.createRandom());

    await poker.connect(signers[0]).createTable(BUY_IN, 3, sessionKeys[0].address, { value: BUY_IN });
    for (let i = 1; i < 4; i++) {
      await poker.connect(signers[i]).joinTable(1n, sessionKeys[i].address, { value: BUY_IN });
    }

    const domain: TypedDataDomain = {
      name: "DecentralisedPoker",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await poker.getAddress(),
    };
    const cp: Checkpoint = {
      tableId: "1",
      checkpointNumber: 1,
      balances: [1500n, 1000n, 1000n, 500n].map((c) => (c * WEI_PER_CHIP).toString()) as Checkpoint["balances"],
      evicted: [false, false, false, false],
    };
    return { signers, poker, sessionKeys, domain, cp };
  }

  it("domain name and version in shared/ match the contract", async () => {
    const { poker } = await setup();
    const d = await poker.eip712Domain(); // OpenZeppelin v5 EIP712
    expect(d.name).to.equal(CHECKPOINT_DOMAIN.name);
    expect(d.version).to.equal(CHECKPOINT_DOMAIN.version);
  });

  it("checkpointHashFor() equals the contract's checkpointDigest()", async () => {
    const { poker, domain, cp } = await setup();
    const onChain: string = await poker.checkpointDigest(
      BigInt(cp.tableId),
      cp.checkpointNumber,
      cp.balances.map((b) => BigInt(b)),
      cp.evicted,
    );
    expect(checkpointHashFor(domain, cp)).to.equal(onChain);

    // and with a different checkpoint, still equal (not a coincidence of defaults)
    const cp2: Checkpoint = { ...cp, checkpointNumber: 2, evicted: [false, false, false, true] };
    const onChain2: string = await poker.checkpointDigest(
      BigInt(cp2.tableId),
      cp2.checkpointNumber,
      cp2.balances.map((b) => BigInt(b)),
      cp2.evicted,
    );
    expect(checkpointHashFor(domain, cp2)).to.equal(onChain2);
  });

  it("4 session-key signatures made in TypeScript are accepted by submitCheckpoint()", async () => {
    const { signers, poker, sessionKeys, domain, cp } = await setup();
    const digest = checkpointHashFor(domain, cp);
    const sigs = sessionKeys.map((w) => new SigningKey(w.privateKey).sign(digest).serialized);

    await (
      await poker
        .connect(signers[0])
        .submitCheckpoint(BigInt(cp.tableId), cp.checkpointNumber, cp.balances.map((b) => BigInt(b)), cp.evicted, sigs)
    ).wait();

    const t = await poker.getTable(1n);
    expect(t.checkpointNumber).to.equal(1n);
  });
});