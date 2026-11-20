const { expect } = require('chai');
const { ethers } = require('hardhat');

const usd = (n) => ethers.parseUnits(String(n), 6);

describe('Quorum', () => {
  let usdc, q, pres, treas, vp, member, vendor;

  beforeEach(async () => {
    [pres, treas, vp, member, vendor] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory('MockUSDC')).deploy();
    q = await (await ethers.getContractFactory('Quorum')).deploy(await usdc.getAddress());
    for (const s of [pres, member]) {
      await usdc.mint(s.address, usd(1000));
      await usdc.connect(s).approve(await q.getAddress(), ethers.MaxUint256);
    }
    // 3 officers, 2 approvals needed, $50/day allowance
    await q.createClub('Illini Robotics', [treas.address, vp.address], 2, usd(50));
  });

  it('creates a club with the creator as an officer', async () => {
    const [c] = await q.getClub(0);
    expect(c.name).to.equal('Illini Robotics');
    expect(c.officers).to.deep.equal([pres.address, treas.address, vp.address]);
    expect(c.threshold).to.equal(2n);
    expect(await q.isOfficer(0, member.address)).to.equal(false);
  });

  it('rejects bad configs', async () => {
    await expect(q.createClub('X', [treas.address], 3, 0)).to.be.revertedWithCustomError(q, 'InvalidConfig');
    await expect(q.createClub('X', [], 0, 0)).to.be.revertedWithCustomError(q, 'InvalidConfig');
    await expect(q.createClub('', [], 1, 0)).to.be.revertedWithCustomError(q, 'InvalidConfig');
  });

  it('records dues and links the member to the club', async () => {
    await q.connect(member).payDues(0, usd(25), 'Fall dues');
    const [c] = await q.getClub(0);
    expect(c.balance).to.equal(usd(25));
    expect(c.totalRaised).to.equal(usd(25));
    const d = await q.getDeposits(0);
    expect(d[0].from).to.equal(member.address);
    expect(d[0].note).to.equal('Fall dues');
    expect(await q.getClubsOf(member.address)).to.deep.equal([0n]);
  });

  it('auto-executes small spends inside the daily allowance', async () => {
    await q.connect(member).payDues(0, usd(200), 'dues');
    await q.connect(treas).requestSpend(0, vendor.address, usd(30), 'Pizza for meeting');
    expect(await usdc.balanceOf(vendor.address)).to.equal(usd(30));
    const r = (await q.getRequests(0))[0];
    expect(r.status).to.equal(1n); // Executed
    expect(r.autoApproved).to.equal(true);
  });

  it('allowance is shared across the day, so small spends cannot drain the club', async () => {
    await q.connect(member).payDues(0, usd(200), 'dues');
    await q.connect(treas).requestSpend(0, vendor.address, usd(30), 'a');
    await q.connect(treas).requestSpend(0, vendor.address, usd(30), 'b'); // 60 > 50 -> needs approval
    const rs = await q.getRequests(0);
    expect(rs[1].status).to.equal(0n); // Pending
    expect(await usdc.balanceOf(vendor.address)).to.equal(usd(30));
    const [, left] = await q.getClub(0);
    expect(left).to.equal(usd(20));
  });

  it('allowance resets the next day', async () => {
    await q.connect(member).payDues(0, usd(200), 'dues');
    await q.connect(treas).requestSpend(0, vendor.address, usd(50), 'a');
    await ethers.provider.send('evm_increaseTime', [86400]);
    await ethers.provider.send('evm_mine', []);
    await q.connect(treas).requestSpend(0, vendor.address, usd(50), 'b');
    expect(await usdc.balanceOf(vendor.address)).to.equal(usd(100));
  });

  it('big spends need the quorum', async () => {
    await q.connect(member).payDues(0, usd(500), 'dues');
    await q.connect(treas).requestSpend(0, vendor.address, usd(300), 'Competition entry fee');
    expect(await usdc.balanceOf(vendor.address)).to.equal(0n);
    await expect(q.connect(treas).approve(0, 0)).to.be.revertedWithCustomError(q, 'AlreadyVoted');
    await q.connect(vp).approve(0, 0);
    expect(await usdc.balanceOf(vendor.address)).to.equal(usd(300));
    const [c] = await q.getClub(0);
    expect(c.balance).to.equal(usd(200));
    expect(c.totalSpent).to.equal(usd(300));
  });

  it('non-officers cannot request or approve', async () => {
    await q.connect(member).payDues(0, usd(500), 'dues');
    await expect(q.connect(member).requestSpend(0, member.address, usd(10), 'me')).to.be.revertedWithCustomError(q, 'NotOfficer');
    await q.connect(treas).requestSpend(0, vendor.address, usd(300), 'x');
    await expect(q.connect(member).approve(0, 0)).to.be.revertedWithCustomError(q, 'NotOfficer');
  });

  it('a request dies once the quorum becomes unreachable', async () => {
    await q.connect(member).payDues(0, usd(500), 'dues');
    await q.connect(treas).requestSpend(0, vendor.address, usd(300), 'Sketchy');
    await q.connect(pres).reject(0, 0);
    await q.connect(vp).reject(0, 0);
    const r = (await q.getRequests(0))[0];
    expect(r.status).to.equal(2n); // Rejected
    await expect(q.connect(vp).approve(0, 0)).to.be.revertedWithCustomError(q, 'NotPending');
  });

  it('requester can cancel; others cannot', async () => {
    await q.connect(member).payDues(0, usd(500), 'dues');
    await q.connect(treas).requestSpend(0, vendor.address, usd(300), 'x');
    await expect(q.connect(vp).cancel(0, 0)).to.be.revertedWithCustomError(q, 'NotOfficer');
    await q.connect(treas).cancel(0, 0);
    expect((await q.getRequests(0))[0].status).to.equal(3n);
  });

  it('cannot request more than the club holds', async () => {
    await q.connect(member).payDues(0, usd(10), 'dues');
    await expect(q.connect(treas).requestSpend(0, vendor.address, usd(11), 'x')).to.be.revertedWithCustomError(q, 'InsufficientClubBalance');
  });

  it('keeps club balances separate', async () => {
    await q.connect(pres).createClub('Chess Club', [], 1, 0);
    await q.connect(member).payDues(0, usd(100), 'robotics');
    await q.connect(member).payDues(1, usd(5), 'chess');
    await expect(q.connect(pres).requestSpend(1, vendor.address, usd(6), 'x')).to.be.revertedWithCustomError(q, 'InsufficientClubBalance');
    await q.connect(pres).requestSpend(1, vendor.address, usd(5), 'Chess boards'); // threshold 1 -> executes
    expect(await usdc.balanceOf(vendor.address)).to.equal(usd(5));
    const [c0] = await q.getClub(0);
    expect(c0.balance).to.equal(usd(100));
  });
});
