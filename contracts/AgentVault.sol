// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// Minimal Uniswap V3 SwapRouter02 interface (Synthra on Arc)
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title AgentVault
/// @notice A sub-account the owner funds and an agent key may spend from WITHOUT the
///         owner's signature — but only within limits enforced here, on-chain:
///         allowed tokens, per-transaction and per-day caps per token, an expiry,
///         an optional recipient allowlist, and a pause switch. Swaps can only go
///         through the configured router and always pay out back into this vault.
/// @dev The agent (an AI-driven backend) is treated as untrusted: if its key or its
///      reasoning is compromised, the worst case is one day's allowance per token.
///      The owner can withdraw everything, pause, or revoke the agent at any time.
contract AgentVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Limit {
        uint128 perTx;
        uint128 perDay; // 0 = token not allowed for the agent
    }

    address public immutable owner;
    address public immutable swapRouter;
    address public agent;
    uint64 public agentExpiresAt;
    bool public paused;
    bool public recipientAllowlistOnly;

    mapping(address token => Limit) public limits;
    mapping(address token => mapping(uint256 day => uint256)) public spentOnDay;
    mapping(address recipient => bool) public allowedRecipient;

    event AgentSet(address indexed agent, uint64 expiresAt);
    event LimitSet(address indexed token, uint128 perTx, uint128 perDay);
    event Paused(bool paused);
    event RecipientAllowed(address indexed recipient, bool allowed);
    event RecipientAllowlistOnly(bool enabled);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event AgentTransfer(address indexed token, address indexed to, uint256 amount);
    event AgentSwap(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    error NotOwner();
    error NotActiveAgent();
    error TokenNotAllowed(address token);
    error ZeroAmount();
    error OverPerTxLimit(uint256 amount, uint256 perTx);
    error OverDailyLimit(uint256 wouldSpend, uint256 perDay);
    error RecipientNotAllowed(address to);
    error ZeroAddress();
    error NoMinimumOutput();
    error LengthMismatch();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyActiveAgent() {
        if (msg.sender != agent || agent == address(0) || paused || block.timestamp >= agentExpiresAt) {
            revert NotActiveAgent();
        }
        _;
    }

    constructor(
        address owner_,
        address agent_,
        uint64 agentExpiresAt_,
        address swapRouter_,
        address[] memory tokens,
        uint128[] memory perTx,
        uint128[] memory perDay
    ) {
        if (owner_ == address(0) || swapRouter_ == address(0)) revert ZeroAddress();
        if (tokens.length != perTx.length || tokens.length != perDay.length) revert LengthMismatch();
        owner = owner_;
        swapRouter = swapRouter_;
        agent = agent_;
        agentExpiresAt = agentExpiresAt_;
        emit AgentSet(agent_, agentExpiresAt_);
        for (uint256 i; i < tokens.length; ++i) {
            _setLimit(tokens[i], perTx[i], perDay[i]);
        }
    }

    // ── Owner controls (always available, even while paused or expired) ──────────

    function setAgent(address agent_, uint64 expiresAt) external onlyOwner {
        agent = agent_;
        agentExpiresAt = expiresAt;
        emit AgentSet(agent_, expiresAt);
    }

    /// One-click kill switch for the agent
    function revokeAgent() external onlyOwner {
        agent = address(0);
        agentExpiresAt = 0;
        emit AgentSet(address(0), 0);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    function setLimit(address token, uint128 perTx, uint128 perDay) external onlyOwner {
        _setLimit(token, perTx, perDay);
    }

    function setRecipientAllowed(address recipient, bool allowed) external onlyOwner {
        allowedRecipient[recipient] = allowed;
        emit RecipientAllowed(recipient, allowed);
    }

    function setRecipientAllowlistOnly(bool enabled) external onlyOwner {
        recipientAllowlistOnly = enabled;
        emit RecipientAllowlistOnly(enabled);
    }

    function withdraw(IERC20 token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit Withdrawn(address(token), to, amount);
    }

    // ── Agent actions (no owner signature; bounded by the limits above) ─────────

    function agentTransfer(IERC20 token, address to, uint256 amount) external onlyActiveAgent nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (recipientAllowlistOnly && !allowedRecipient[to]) revert RecipientNotAllowed(to);
        _spend(address(token), amount);
        token.safeTransfer(to, amount);
        emit AgentTransfer(address(token), to, amount);
    }

    /// Swaps through the configured router only; the output always comes back here.
    function agentSwap(IERC20 tokenIn, IERC20 tokenOut, uint24 fee, uint256 amountIn, uint256 minOut)
        external
        onlyActiveAgent
        nonReentrant
        returns (uint256 amountOut)
    {
        if (limits[address(tokenOut)].perDay == 0) revert TokenNotAllowed(address(tokenOut));
        if (minOut == 0) revert NoMinimumOutput();
        _spend(address(tokenIn), amountIn);

        tokenIn.forceApprove(swapRouter, amountIn);
        amountOut = ISwapRouter02(swapRouter).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(tokenIn),
                tokenOut: address(tokenOut),
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        tokenIn.forceApprove(swapRouter, 0); // never leave a standing approval
        emit AgentSwap(address(tokenIn), address(tokenOut), amountIn, amountOut);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function remainingToday(address token) external view returns (uint256) {
        uint256 cap = limits[token].perDay;
        uint256 spent = spentOnDay[token][block.timestamp / 1 days];
        return spent >= cap ? 0 : cap - spent;
    }

    function agentActive() external view returns (bool) {
        return agent != address(0) && !paused && block.timestamp < agentExpiresAt;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _setLimit(address token, uint128 perTx, uint128 perDay) internal {
        if (token == address(0)) revert ZeroAddress();
        limits[token] = Limit(perTx, perDay);
        emit LimitSet(token, perTx, perDay);
    }

    function _spend(address token, uint256 amount) internal {
        Limit memory l = limits[token];
        if (l.perDay == 0) revert TokenNotAllowed(token);
        if (amount == 0) revert ZeroAmount();
        if (amount > l.perTx) revert OverPerTxLimit(amount, l.perTx);
        uint256 day = block.timestamp / 1 days;
        uint256 wouldSpend = spentOnDay[token][day] + amount;
        if (wouldSpend > l.perDay) revert OverDailyLimit(wouldSpend, l.perDay);
        spentOnDay[token][day] = wouldSpend;
    }
}

/// @title AgentVaultFactory
/// @notice Deploys one AgentVault per call, owned by the caller.
contract AgentVaultFactory {
    address public immutable swapRouter;
    mapping(address owner => address[]) private _vaults;

    event VaultCreated(address indexed owner, address indexed vault, address indexed agent);

    constructor(address swapRouter_) {
        swapRouter = swapRouter_;
    }

    function createVault(
        address agent,
        uint64 agentExpiresAt,
        address[] calldata tokens,
        uint128[] calldata perTx,
        uint128[] calldata perDay
    ) external returns (address vault) {
        vault = address(new AgentVault(msg.sender, agent, agentExpiresAt, swapRouter, tokens, perTx, perDay));
        _vaults[msg.sender].push(vault);
        emit VaultCreated(msg.sender, vault, agent);
    }

    function vaultsOf(address owner) external view returns (address[] memory) {
        return _vaults[owner];
    }
}
