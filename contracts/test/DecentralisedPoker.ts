import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const BUY_IN = ethers.parseEther("0.001"); // 1e15 wei, divisible by 1000
const WEI_PER_CHIP = BUY_IN / 1000n;
const TABLE_ID = 1n;

const CHECKPOINT_TYPES = {
  Checkpoint: [
    { name: "tableId", type: "uint256" },
    { name: "checkpointNumber", type: "uint64" },
    { name: "balances", type: "uint256[4]" },
    { name: "evicted", type: "bool[4]" },
  ],
};

const chips = (a: number, b: number, c: number, d: number): [bigint, bigint, bigint, bigint] =>
  [a, b, c, d].map((x) => BigInt(x) * WEI_PER_CHIP) as [bigint, bigint, bigint, bigint];

async function deployFixture() {
  const [p0, p1, p2, p3, outsider] = await ethers.getSigners();
  const players = [p0, p1, p2, p3];
  const sessions = players.map(() => ethers.Wallet.createRandom());
  const poker = await (await ethers.getContractFactory("DecentralisedPoker")).deploy();
  await poker.waitForDeployment();
  const { chainId } = await ethers.provider.getNetwork();
  const domain = {
    name: "DecentralisedPoker",
    version: "1",
    chainId,
    verifyingContract: await poker.getAddress(),
  };
  return { poker, players, sessions, outsider, domain };
}

async function fullTableFixture() {
  const f = await deployFixture();
  const { poker, players, sessions } = f;
  await poker.connect(players[0]).createTable(BUY_IN, 10, sessions[0].address, { value: BUY_IN });
  for (let i = 1; i < 4; i++) {
    await poker.connect(players[i]).joinTable(TABLE_ID, sessions[i].address, { value: BUY_IN });
  }
  return f;
}

async function sign(
  f: Awaited<ReturnType<typeof deployFixture>>,
  tableId: bigint,
  num: number,
  balances: bigint[],
  evicted: boolean[] = [false, false, false, false],
  signerOverride: Record<number, ethers.Wallet> = {}
) {
  const sigs: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (evicted[i]) {
      sigs.push("0x");
      continue;
    }
    const signer = signerOverride[i] ?? f.sessions[i];
    sigs.push(
      await signer.signTypedData(f.domain, CHECKPOINT_TYPES, {
        tableId,
        checkpointNumber: num,
        balances,
        evicted,
      })
    );
  }
  return sigs;
}

describe("DecentralisedPoker", () => {
  describe("createTable / joinTable / cancelTable", () => {
    it("rejects a buy-in not divisible by 1000", async () => {
      const { poker, players, sessions } = await loadFixture(deployFixture);
      await expect(
        poker.connect(players[0]).createTable(1001, 10, sessions[0].address, { value: 1001 })
      ).to.be.revertedWith("BUYIN_NOT_DIVISIBLE_BY_1000");
    });

    it("rejects a wrong deposit on create and join", async () => {
      const { poker, players, sessions } = await loadFixture(deployFixture);
      await expect(
        poker.connect(players[0]).createTable(BUY_IN, 10, sessions[0].address, { value: BUY_IN - 1n })
      ).to.be.revertedWith("WRONG_BUYIN");
      await poker.connect(players[0]).createTable(BUY_IN, 10, sessions[0].address, { value: BUY_IN });
      await expect(
        poker.connect(players[1]).joinTable(TABLE_ID, sessions[1].address, { value: BUY_IN + 1n })
      ).to.be.revertedWith("WRONG_BUYIN");
    });

    it("rejects double-seating and a reused session key", async () => {
      const { poker, players, sessions } = await loadFixture(deployFixture);
      await poker.connect(players[0]).createTable(BUY_IN, 10, sessions[0].address, { value: BUY_IN });
      await expect(
        poker.connect(players[0]).joinTable(TABLE_ID, sessions[1].address, { value: BUY_IN })
      ).to.be.revertedWith("ALREADY_SEATED");
      await expect(
        poker.connect(players[1]).joinTable(TABLE_ID, sessions[0].address, { value: BUY_IN })
      ).to.be.revertedWith("SESSION_KEY_TAKEN");
    });

    it("starts the table when seat 3 fills and blocks a 5th joiner", async () => {
      const { poker, outsider, sessions } = await loadFixture(fullTableFixture);
      const t = await poker.getTable(TABLE_ID);
      expect(t.status).to.equal(2n); // Started
      expect(t.totalDeposited).to.equal(BUY_IN * 4n);
      await expect(
        poker.connect(outsider).joinTable(TABLE_ID, sessions[0].address, { value: BUY_IN })
      ).to.be.revertedWith("NOT_OPEN");
    });

    it("lets a seated player cancel and everyone withdraw their deposit", async () => {
      const { poker, players, sessions, outsider } = await loadFixture(deployFixture);
      await poker.connect(players[0]).createTable(BUY_IN, 10, sessions[0].address, { value: BUY_IN });
      await poker.connect(players[1]).joinTable(TABLE_ID, sessions[1].address, { value: BUY_IN });
      await expect(poker.connect(outsider).cancelTable(TABLE_ID)).to.be.revertedWith("NOT_A_PLAYER");
      await poker.connect(players[1]).cancelTable(TABLE_ID);
      await expect(poker.connect(players[0]).withdraw(TABLE_ID)).to.changeEtherBalance(players[0], BUY_IN);
      await expect(poker.connect(players[1]).withdraw(TABLE_ID)).to.changeEtherBalance(players[1], BUY_IN);
    });

    it("cannot cancel once the table is full", async () => {
      const { poker, players } = await loadFixture(fullTableFixture);
      await expect(poker.connect(players[0]).cancelTable(TABLE_ID)).to.be.revertedWith("NOT_OPEN");
    });
  });

  describe("checkpoints", () => {
    it("happy path: submit, wait, finalize, withdraw, and double-withdraw fails", async () => {
      const f = await loadFixture(fullTableFixture);
      const { poker, players } = f;
      const balances = chips(1300, 700, 1200, 800);
      const sigs = await sign(f, TABLE_ID, 3, balances);
      await poker.connect(players[2]).submitCheckpoint(TABLE_ID, 3, balances, [false, false, false, false], sigs as any);

      await expect(poker.finalize(TABLE_ID)).to.be.revertedWith("WINDOW_OPEN");
      await time.increase(2 * 60 + 1);
      await poker.finalize(TABLE_ID);

      for (let i = 0; i < 4; i++) {
        await expect(poker.connect(players[i]).withdraw(TABLE_ID)).to.changeEtherBalance(players[i], balances[i]);
      }
      await expect(poker.connect(players[0]).withdraw(TABLE_ID)).to.be.revertedWith("NOTHING_TO_WITHDRAW");
    });

    it("rejects a bad signature", async () => {
      const f = await loadFixture(fullTableFixture);
      const balances = chips(1000, 1000, 1000, 1000);
      const impostor = ethers.Wallet.createRandom();
      const sigs = await sign(f, TABLE_ID, 1, balances, [false, false, false, false], { 2: impostor });
      await expect(
        f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 1, balances, [false, false, false, false], sigs as any)
      ).to.be.revertedWith("BAD_SIGNATURE");
    });

    it("rejects a stale or repeated checkpoint number", async () => {
      const f = await loadFixture(fullTableFixture);
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      const b2 = chips(1100, 900, 1000, 1000);
      await f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 2, b2, ev, (await sign(f, TABLE_ID, 2, b2)) as any);

      const b1 = chips(1000, 1000, 1000, 1000);
      await expect(
        f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 1, b1, ev, (await sign(f, TABLE_ID, 1, b1)) as any)
      ).to.be.revertedWith("STALE_CHECKPOINT");
      await expect(
        f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 2, b2, ev, (await sign(f, TABLE_ID, 2, b2)) as any)
      ).to.be.revertedWith("STALE_CHECKPOINT");
    });

    it("rejects balances that do not sum to the total deposited", async () => {
      const f = await loadFixture(fullTableFixture);
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      const bad = chips(1000, 1000, 1000, 1001);
      await expect(
        f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 1, bad, ev, (await sign(f, TABLE_ID, 1, bad)) as any)
      ).to.be.revertedWith("BALANCE_MISMATCH");
    });

    it("rejects balances that are not whole chips", async () => {
      const f = await loadFixture(fullTableFixture);
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      const base = chips(1000, 1000, 1000, 1000);
      const bad: [bigint, bigint, bigint, bigint] = [base[0] + 1n, base[1] - 1n, base[2], base[3]];
      await expect(
        f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 1, bad, ev, (await sign(f, TABLE_ID, 1, bad)) as any)
      ).to.be.revertedWith("BAD_CHIP_AMOUNT");
    });

    it("only table players can submit", async () => {
      const f = await loadFixture(fullTableFixture);
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      const b = chips(1000, 1000, 1000, 1000);
      await expect(
        f.poker.connect(f.outsider).submitCheckpoint(TABLE_ID, 1, b, ev, (await sign(f, TABLE_ID, 1, b)) as any)
      ).to.be.revertedWith("NOT_A_PLAYER");
    });

    it("a checkpoint signed for table 1 cannot be replayed on table 2", async () => {
      const f = await loadFixture(fullTableFixture);
      const { poker, players, sessions } = f;
      // table 2 with the same players and session keys
      await poker.connect(players[0]).createTable(BUY_IN, 10, sessions[0].address, { value: BUY_IN });
      for (let i = 1; i < 4; i++) {
        await poker.connect(players[i]).joinTable(2n, sessions[i].address, { value: BUY_IN });
      }
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      const b = chips(1100, 900, 1000, 1000);
      const sigsForTable1 = await sign(f, TABLE_ID, 1, b);
      await expect(
        poker.connect(players[0]).submitCheckpoint(2n, 1, b, ev, sigsForTable1 as any)
      ).to.be.revertedWith("BAD_SIGNATURE");
    });

    it("a newer checkpoint replaces an older one inside the window, but not after it", async () => {
      const f = await loadFixture(fullTableFixture);
      const { poker, players } = f;
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      const b1 = chips(1200, 800, 1000, 1000);
      const b2 = chips(900, 1100, 1000, 1000);
      await poker.connect(players[0]).submitCheckpoint(TABLE_ID, 1, b1, ev, (await sign(f, TABLE_ID, 1, b1)) as any);
      await poker.connect(players[1]).submitCheckpoint(TABLE_ID, 2, b2, ev, (await sign(f, TABLE_ID, 2, b2)) as any);

      await time.increase(2 * 60 + 1);
      const b3 = chips(1000, 1000, 1000, 1000);
      await expect(
        poker.connect(players[0]).submitCheckpoint(TABLE_ID, 3, b3, ev, (await sign(f, TABLE_ID, 3, b3)) as any)
      ).to.be.revertedWith("WINDOW_CLOSED");

      await poker.finalize(TABLE_ID);
      await expect(poker.connect(players[0]).withdraw(TABLE_ID)).to.changeEtherBalance(players[0], b2[0]);
    });

    it("eviction: three signers can evict a seat, and the evicted seat still gets its balance", async () => {
      const f = await loadFixture(fullTableFixture);
      const { poker, players } = f;
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, true];
      const b = chips(1300, 1100, 1100, 500);
      await poker.connect(players[0]).submitCheckpoint(TABLE_ID, 1, b, ev, (await sign(f, TABLE_ID, 1, b, ev)) as any);
      await time.increase(2 * 60 + 1);
      await poker.finalize(TABLE_ID);
      await expect(poker.connect(players[3]).withdraw(TABLE_ID)).to.changeEtherBalance(players[3], b[3]);
    });

    it("rejects a checkpoint with fewer than 3 signers", async () => {
      const f = await loadFixture(fullTableFixture);
      const ev: [boolean, boolean, boolean, boolean] = [false, false, true, true];
      const b = chips(2000, 2000, 0, 0);
      await expect(
        f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 1, b, ev, (await sign(f, TABLE_ID, 1, b, ev)) as any)
      ).to.be.revertedWith("TOO_FEW_SIGNERS");
    });
  });

  describe("emergencyRefund", () => {
    it("is blocked early, works after the deadline, and refunds every buy-in", async () => {
      const { poker, players } = await loadFixture(fullTableFixture);
      await expect(poker.connect(players[0]).emergencyRefund(TABLE_ID)).to.be.revertedWith("TOO_EARLY");

      const deadline = await poker.refundDeadline(TABLE_ID);
      await time.increaseTo(deadline + 1n);
      await poker.connect(players[0]).emergencyRefund(TABLE_ID);

      for (let i = 0; i < 4; i++) {
        await expect(poker.connect(players[i]).withdraw(TABLE_ID)).to.changeEtherBalance(players[i], BUY_IN);
      }
    });

    it("is blocked once a checkpoint has been submitted", async () => {
      const f = await loadFixture(fullTableFixture);
      const ev: [boolean, boolean, boolean, boolean] = [false, false, false, false];
      const b = chips(1000, 1000, 1000, 1000);
      await f.poker.connect(f.players[0]).submitCheckpoint(TABLE_ID, 1, b, ev, (await sign(f, TABLE_ID, 1, b)) as any);
      const deadline = await f.poker.refundDeadline(TABLE_ID);
      await time.increaseTo(deadline + 1n);
      await expect(f.poker.connect(f.players[0]).emergencyRefund(TABLE_ID)).to.be.revertedWith("CHECKPOINT_EXISTS");
    });
  });
});