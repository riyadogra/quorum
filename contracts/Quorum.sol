// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Quorum: a club treasury nobody can run off with.
/// @notice Members pay dues in USDC. Officers spend small amounts up to a daily
///         allowance on their own; anything bigger needs a quorum of officers to
///         approve. Every deposit and spend is recorded on-chain for all members.
contract Quorum {
    IERC20 public immutable usdc;

    uint256 public constant MAX_OFFICERS = 20;

    enum Status { Pending, Executed, Rejected, Cancelled }

    struct Club {
        string name;
        address creator;
        uint64 threshold;     // officer approvals needed for spends above the allowance
        uint64 createdAt;
        uint256 dailyLimit;   // USDC (6 decimals) one officer can spend per day without approvals
        uint256 balance;      // USDC held for this club
        uint256 totalRaised;
        uint256 totalSpent;
        uint256 spentToday;
        uint64 dayIndex;
        address[] officers;
    }

    struct Request {
        address requester;
        address to;
        uint256 amount;
        string reason;
        uint64 approvals;
        uint64 rejections;
        uint64 createdAt;
        uint64 decidedAt;
        Status status;
        bool autoApproved;
    }

    struct Deposit {
        address from;
        uint256 amount;
        string note;
        uint64 at;
    }

    Club[] private clubs;
    mapping(uint256 => Request[]) private requests;
    mapping(uint256 => Deposit[]) private deposits;
    mapping(uint256 => mapping(address => bool)) public isOfficer;
    // club => request => officer => 0 none, 1 approved, 2 rejected
    mapping(uint256 => mapping(uint256 => mapping(address => uint8))) public voteOf;
    mapping(address => uint256[]) private clubsOfAccount;
    mapping(uint256 => mapping(address => bool)) private linked;

    event ClubCreated(uint256 indexed clubId, string name, address indexed creator);
    event DuesPaid(uint256 indexed clubId, address indexed from, uint256 amount, string note);
    event SpendRequested(uint256 indexed clubId, uint256 indexed requestId, address indexed requester, address to, uint256 amount, string reason);
    event Voted(uint256 indexed clubId, uint256 indexed requestId, address indexed officer, bool approve);
    event SpendExecuted(uint256 indexed clubId, uint256 indexed requestId, address to, uint256 amount, bool autoApproved);
    event SpendRejected(uint256 indexed clubId, uint256 indexed requestId);
    event SpendCancelled(uint256 indexed clubId, uint256 indexed requestId);

    error NotOfficer();
    error BadClub();
    error BadRequest();
    error NotPending();
    error AlreadyVoted();
    error InvalidConfig();
    error InsufficientClubBalance();
    error ZeroAmount();
    error TransferFailed();

    constructor(address usdc_) {
        usdc = IERC20(usdc_);
    }

    modifier clubExists(uint256 clubId) {
        if (clubId >= clubs.length) revert BadClub();
        _;
    }

    modifier onlyOfficer(uint256 clubId) {
        if (clubId >= clubs.length) revert BadClub();
        if (!isOfficer[clubId][msg.sender]) revert NotOfficer();
        _;
    }

    // ------------------------------------------------------------------ setup

    function createClub(
        string calldata name,
        address[] calldata officers,
        uint64 threshold,
        uint256 dailyLimit
    ) external returns (uint256 clubId) {
        if (bytes(name).length == 0 || bytes(name).length > 60) revert InvalidConfig();

        clubId = clubs.length;
        clubs.push();
        Club storage c = clubs[clubId];
        c.name = name;
        c.creator = msg.sender;
        c.createdAt = uint64(block.timestamp);
        c.dailyLimit = dailyLimit;

        _addOfficer(clubId, msg.sender);
        for (uint256 i = 0; i < officers.length; i++) {
            address o = officers[i];
            if (o != address(0) && !isOfficer[clubId][o]) _addOfficer(clubId, o);
        }
        uint256 n = c.officers.length;
        if (n > MAX_OFFICERS || threshold == 0 || threshold > n) revert InvalidConfig();
        c.threshold = threshold;

        emit ClubCreated(clubId, name, msg.sender);
    }

    function _addOfficer(uint256 clubId, address o) private {
        isOfficer[clubId][o] = true;
        clubs[clubId].officers.push(o);
        _link(clubId, o);
    }

    function _link(uint256 clubId, address a) private {
        if (!linked[clubId][a]) {
            linked[clubId][a] = true;
            clubsOfAccount[a].push(clubId);
        }
    }

    // ------------------------------------------------------------------ money in

    /// @notice Pay dues (or any contribution). Requires a USDC approval first.
    function payDues(uint256 clubId, uint256 amount, string calldata note) external clubExists(clubId) {
        if (amount == 0) revert ZeroAmount();
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        Club storage c = clubs[clubId];
        c.balance += amount;
        c.totalRaised += amount;
        deposits[clubId].push(Deposit(msg.sender, amount, _clip(note, 80), uint64(block.timestamp)));
        _link(clubId, msg.sender);
        emit DuesPaid(clubId, msg.sender, amount, note);
    }

    // ------------------------------------------------------------------ money out

    /// @notice Request a spend. Small spends within the daily allowance execute
    ///         immediately; bigger ones wait for officer approvals.
    function requestSpend(uint256 clubId, address to, uint256 amount, string calldata reason)
        external
        onlyOfficer(clubId)
        returns (uint256 requestId)
    {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert InvalidConfig();
        Club storage c = clubs[clubId];
        if (amount > c.balance) revert InsufficientClubBalance();

        requestId = requests[clubId].length;
        requests[clubId].push(Request({
            requester: msg.sender,
            to: to,
            amount: amount,
            reason: _clip(reason, 120),
            approvals: 1,
            rejections: 0,
            createdAt: uint64(block.timestamp),
            decidedAt: 0,
            status: Status.Pending,
            autoApproved: false
        }));
        voteOf[clubId][requestId][msg.sender] = 1;
        emit SpendRequested(clubId, requestId, msg.sender, to, amount, reason);

        _rollDay(c);
        if (c.spentToday + amount <= c.dailyLimit) {
            c.spentToday += amount;
            requests[clubId][requestId].autoApproved = true;
            _execute(clubId, requestId);
        } else if (c.threshold <= 1) {
            _execute(clubId, requestId);
        }
    }

    function approve(uint256 clubId, uint256 requestId) external onlyOfficer(clubId) {
        Request storage r = _pending(clubId, requestId);
        if (voteOf[clubId][requestId][msg.sender] != 0) revert AlreadyVoted();
        voteOf[clubId][requestId][msg.sender] = 1;
        r.approvals += 1;
        emit Voted(clubId, requestId, msg.sender, true);
        if (r.approvals >= clubs[clubId].threshold) _execute(clubId, requestId);
    }

    function reject(uint256 clubId, uint256 requestId) external onlyOfficer(clubId) {
        Request storage r = _pending(clubId, requestId);
        if (voteOf[clubId][requestId][msg.sender] != 0) revert AlreadyVoted();
        voteOf[clubId][requestId][msg.sender] = 2;
        r.rejections += 1;
        emit Voted(clubId, requestId, msg.sender, false);
        Club storage c = clubs[clubId];
        // Once enough officers say no that the threshold can no longer be reached, it's dead.
        if (c.officers.length - r.rejections < c.threshold) {
            r.status = Status.Rejected;
            r.decidedAt = uint64(block.timestamp);
            emit SpendRejected(clubId, requestId);
        }
    }

    function cancel(uint256 clubId, uint256 requestId) external clubExists(clubId) {
        Request storage r = _pending(clubId, requestId);
        if (r.requester != msg.sender) revert NotOfficer();
        r.status = Status.Cancelled;
        r.decidedAt = uint64(block.timestamp);
        emit SpendCancelled(clubId, requestId);
    }

    function _execute(uint256 clubId, uint256 requestId) private {
        Club storage c = clubs[clubId];
        Request storage r = requests[clubId][requestId];
        if (r.amount > c.balance) revert InsufficientClubBalance();
        c.balance -= r.amount;
        c.totalSpent += r.amount;
        r.status = Status.Executed;
        r.decidedAt = uint64(block.timestamp);
        if (!usdc.transfer(r.to, r.amount)) revert TransferFailed();
        emit SpendExecuted(clubId, requestId, r.to, r.amount, r.autoApproved);
    }

    function _pending(uint256 clubId, uint256 requestId) private view returns (Request storage r) {
        if (requestId >= requests[clubId].length) revert BadRequest();
        r = requests[clubId][requestId];
        if (r.status != Status.Pending) revert NotPending();
    }

    function _rollDay(Club storage c) private {
        uint64 today = uint64(block.timestamp / 1 days);
        if (today != c.dayIndex) {
            c.dayIndex = today;
            c.spentToday = 0;
        }
    }

    function _clip(string calldata s, uint256 max) private pure returns (string memory) {
        bytes calldata b = bytes(s);
        if (b.length <= max) return s;
        return string(b[:max]);
    }

    // ------------------------------------------------------------------ views

    function clubCount() external view returns (uint256) {
        return clubs.length;
    }

    function getClub(uint256 clubId) external view clubExists(clubId) returns (Club memory c, uint256 allowanceLeft) {
        c = clubs[clubId];
        uint256 spent = (uint64(block.timestamp / 1 days) == c.dayIndex) ? c.spentToday : 0;
        allowanceLeft = c.dailyLimit > spent ? c.dailyLimit - spent : 0;
    }

    function getRequests(uint256 clubId) external view returns (Request[] memory) {
        return requests[clubId];
    }

    function getDeposits(uint256 clubId) external view returns (Deposit[] memory) {
        return deposits[clubId];
    }

    function getClubsOf(address account) external view returns (uint256[] memory) {
        return clubsOfAccount[account];
    }
}
