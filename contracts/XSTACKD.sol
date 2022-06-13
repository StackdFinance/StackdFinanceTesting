pragma solidity ^0.8.10;

// SPDX-License-Identifier: UNLICENSED

library SafeMath {
    function tryAdd(uint256 a, uint256 b)
    internal
    pure
    returns (bool, uint256)
    {
    unchecked {
        uint256 c = a + b;
        if (c < a) return (false, 0);
        return (true, c);
    }
    }

    function trySub(uint256 a, uint256 b)
    internal
    pure
    returns (bool, uint256)
    {
    unchecked {
        if (b > a) return (false, 0);
        return (true, a - b);
    }
    }

    function tryMul(uint256 a, uint256 b)
    internal
    pure
    returns (bool, uint256)
    {
    unchecked {
        // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
        // benefit is lost if 'b' is also tested.
        // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
        if (a == 0) return (true, 0);
        uint256 c = a * b;
        if (c / a != b) return (false, 0);
        return (true, c);
    }
    }

    function tryDiv(uint256 a, uint256 b)
    internal
    pure
    returns (bool, uint256)
    {
    unchecked {
        if (b == 0) return (false, 0);
        return (true, a / b);
    }
    }

    function tryMod(uint256 a, uint256 b)
    internal
    pure
    returns (bool, uint256)
    {
    unchecked {
        if (b == 0) return (false, 0);
        return (true, a % b);
    }
    }

    function add(uint256 a, uint256 b) internal pure returns (uint256) {
        return a + b;
    }

    function sub(uint256 a, uint256 b) internal pure returns (uint256) {
        return a - b;
    }

    function mul(uint256 a, uint256 b) internal pure returns (uint256) {
        return a * b;
    }

    function div(uint256 a, uint256 b) internal pure returns (uint256) {
        return a / b;
    }

    function mod(uint256 a, uint256 b) internal pure returns (uint256) {
        return a % b;
    }

    function sub(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
    unchecked {
        require(b <= a, errorMessage);
        return a - b;
    }
    }

    function div(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
    unchecked {
        require(b > 0, errorMessage);
        return a / b;
    }
    }

    function mod(
        uint256 a,
        uint256 b,
        string memory errorMessage
    ) internal pure returns (uint256) {
    unchecked {
        require(b > 0, errorMessage);
        return a % b;
    }
    }
}

interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB)
    external
    returns (address pair);
}

interface IDexRouter {
    function factory() external pure returns (address);

    function WETH() external pure returns (address);

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    )
    external
    payable
    returns (
        uint256 amountToken,
        uint256 amountETH,
        uint256 liquidity
    );

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;

    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}

interface IERC20Extended {
    function totalSupply() external view returns (uint256);

    function decimals() external view returns (uint8);

    function symbol() external view returns (string memory);

    function name() external view returns (string memory);

    function balanceOf(address account) external view returns (uint256);

    function transfer(address recipient, uint256 amount)
    external
    returns (bool);

    function allowance(address _owner, address spender)
    external
    view
    returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(
        address indexed owner,
        address indexed spender,
        uint256 value
    );
}

abstract contract Auth {
    address internal owner;
    mapping(address => bool) internal authorizations;

    constructor(address _owner) {
        owner = _owner;
        authorizations[_owner] = true;
    }

    modifier onlyOwner() {
        require(isOwner(msg.sender), "!OWNER");
        _;
    }

    modifier authorized() {
        require(isAuthorized(msg.sender), "!AUTHORIZED");
        _;
    }

    function authorize(address adr) public onlyOwner {
        authorizations[adr] = true;
    }

    function unauthorize(address adr) public onlyOwner {
        authorizations[adr] = false;
    }

    function isOwner(address account) public view returns (bool) {
        return account == owner;
    }

    function isAuthorized(address adr) public view returns (bool) {
        return authorizations[adr];
    }

    function transferOwnership(address payable adr) public onlyOwner {
        owner = adr;
        authorizations[adr] = true;
        emit OwnershipTransferred(adr);
    }

    event OwnershipTransferred(address owner);
}


contract XSTACKD is IERC20Extended, Auth {
    using SafeMath for uint256;

    string private constant _name = "XSTACKD";
    string private constant _symbol = "XSTACKD";
    uint8 private constant _decimals = 18;
    uint256 private constant _totalSupply =
    20_000_000 * 10**_decimals;

    address public constant DEAD = address(0xdead);
    address public constant ZERO = address(0);
    address public pair;
    address public autoLiquidityReceiver = 0x393B9D84495FdAf7098dd623260Af93274F4Bcb1; // address to receive LP tokens from liquidity add from fee
    address public marketingFeeReceiver = 0xEe8948866c7885e36C928cfd702947512cf7067e; // address to receive marketing fee
    address public stakingFeeReceiver = 0x550DbD64c3dA1E285A1598784013d79a84dEd60F; // address to receive staking fee

    // fees info
    uint256 public liquidityFee = 100;
    uint256 public marketingFee = 100;
    uint256 public stakingFee = 100;
    uint256 public totalFee = 300;
    uint256 public feeDenominator = 10000;

    uint256 public swapThreshold = _totalSupply / 2000;

    bool public swapEnabled;
    bool public liquidityEnabled;


    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => bool) public isFeeExempt;

    IDexRouter public router;

    event AutoLiquify(uint256 amountBNB, uint256 amountBOG);

    bool inSwap;
    modifier swapping() {
        inSwap = true;
        _;
        inSwap = false;
    }

    constructor()
    payable
    Auth(msg.sender)
    {

        //router = IDexRouter(0x10ED43C718714eb63d5aA57B78B54704E256024E);
        router = IDexRouter(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D); // Testnet

        isFeeExempt[msg.sender] = true;
        isFeeExempt[marketingFeeReceiver] = true;
        isFeeExempt[autoLiquidityReceiver] = true;
        isFeeExempt[stakingFeeReceiver] = true;

        _allowances[address(this)][address(router)] = _totalSupply;

        _balances[msg.sender] = _totalSupply;
        emit Transfer(address(0), msg.sender, _totalSupply);
    }

    receive() external payable {}

    function setLiquidityEnabled(address _pool) external authorized {
        require(!liquidityEnabled, "Liquidity Is already enabled");
        pair = _pool;
        _allowances[address(this)][address(pair)] = _totalSupply;
        swapEnabled = true;
        liquidityEnabled = true;
    }

    // Standard ERC-20 Functions
    function totalSupply()
    external
    pure
    override
    returns (uint256)
    {
        return _totalSupply;
    }


    function decimals()
    external
    pure
    override
    returns (uint8)
    {
        return _decimals;
    }


    function symbol()
    external
    pure
    override
    returns (string memory)
    {
        return _symbol;
    }


    function name()
    external
    pure
    override
    returns (string memory)
    {
        return _name;
    }


    function balanceOf(
        address account
    )
    public
    view
    override
    returns (uint256)
    {
        return _balances[account];
    }


    function allowance(
        address holder,
        address spender
    )
    external
    view
    override
    returns (uint256)
    {
        return _allowances[holder][spender];
    }


    function approve(
        address spender,
        uint256 amount
    )
    public
    override
    returns (bool)
    {
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }


    function approveMax(
        address spender
    )
    external
    returns (bool)
    {
        return approve(spender, _totalSupply);
    }


    function transfer(
        address recipient,
        uint256 amount
    )
    external
    override
    returns (bool)
    {
        return _transferFrom(msg.sender, recipient, amount);
    }


    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    )
    external
    override
    returns (bool)
    {
        if (_allowances[sender][msg.sender] != _totalSupply) {
            _allowances[sender][msg.sender] = _allowances[sender][msg.sender]
            .sub(amount, "Insufficient Allowance");
        }

        return _transferFrom(sender, recipient, amount);
    }


    function _transferFrom(
        address sender,
        address recipient,
        uint256 amount
    )
    internal
    returns (bool)
    {

        if (inSwap) {
            return _basicTransfer(sender, recipient, amount);
        }

        if (shouldSwapBack()) {
            swapBack();
        }

        _balances[sender] = _balances[sender].sub(
            amount,
            "Insufficient Balance"
        );

        uint256 amountReceived;
        amountReceived = shouldTakeFee(sender, recipient)
        ? takeFee(sender, recipient, amount)
        : amount;

        _balances[recipient] = _balances[recipient].add(amountReceived);

        emit Transfer(sender, recipient, amountReceived);
        return true;
    }


    function _basicTransfer(
        address sender,
        address recipient,
        uint256 amount
    )
    internal
    returns (bool)
    {
        _balances[sender] = _balances[sender].sub(
            amount,
            "Insufficient Balance"
        );
        _balances[recipient] = _balances[recipient].add(amount);
        emit Transfer(sender, recipient, amount);
        return true;
    }


    function shouldTakeFee(
        address sender,
        address recipient
    )
    internal
    view
    returns (bool)
    {
        if (isFeeExempt[sender] || isFeeExempt[recipient]) {
            return false;
        }
        else if (sender != pair && recipient != pair) {
            return false;
        }
        return true;
    }


    function getTotalFee()
    public
    view
    returns (uint256)
    {
        return totalFee;
    }


    function takeFee(
        address sender,
        address receiver,
        uint256 amount
    )
    internal
    returns (uint256)
    {
        uint256 feeAmount = amount.mul(getTotalFee()).div(
            feeDenominator
        );

        _balances[address(this)] = _balances[address(this)].add(feeAmount);
        emit Transfer(sender, address(this), feeAmount);

        return amount.sub(feeAmount);
    }


    function shouldSwapBack()
    internal
    view
    returns (bool)
    {
        return
        msg.sender != pair &&
        !inSwap &&
        swapEnabled &&
        _balances[address(this)] >= swapThreshold;
    }


    function swapBack()
    internal
    swapping
    {
        uint256 amountTokenStaking = swapThreshold.mul(stakingFee).div(
            totalFee
        );
        uint256 dynamicLiquidityFee = liquidityFee;
        uint256 amountToLiquify = swapThreshold
        .mul(dynamicLiquidityFee)
        .div(totalFee)
        .div(2);
        uint256 amountToSwap = swapThreshold.sub(amountToLiquify).sub(
            amountTokenStaking
        );

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = router.WETH();
        uint256 balanceBefore = address(this).balance;

        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountToSwap,
            0,
            path,
            address(this),
            block.timestamp
        );

        uint256 amountBNB = address(this).balance.sub(balanceBefore);

        uint256 totalBNBFee = totalFee.sub(dynamicLiquidityFee.div(2)).sub(
            stakingFee
        );

        uint256 amountBNBLiquidity = amountBNB
        .mul(dynamicLiquidityFee)
        .div(totalBNBFee)
        .div(2);
        uint256 amountBNBMarketing = amountBNB.mul(marketingFee).div(
            totalBNBFee
        );

        payable(marketingFeeReceiver).transfer(amountBNBMarketing);
        _balances[stakingFeeReceiver] = _balances[stakingFeeReceiver].add(
            amountTokenStaking
        );

        if (amountToLiquify > 0) {
            router.addLiquidityETH{value: amountBNBLiquidity}(
                address(this),
                amountToLiquify,
                0,
                0,
                autoLiquidityReceiver,
                block.timestamp
            );
            emit AutoLiquify(amountBNBLiquidity, amountToLiquify);
        }
    }


    function setRoute(
        address _router,
        address _pair
    )
    external
    authorized
    {
        router = IDexRouter(_router);
        pair = _pair;
    }


    function setIsFeeExempt(
        address holder,
        bool exempt
    )
    external
    authorized
    {
        isFeeExempt[holder] = exempt;
    }


    function setFees(
        uint256 _liquidityFee,
        uint256 _marketingFee,
        uint256 _stakingFee,
        uint256 _feeDenominator
    )
    external
    authorized
    {
        liquidityFee = _liquidityFee;
        marketingFee = _marketingFee;
        stakingFee = _stakingFee;
        totalFee = _liquidityFee
        .add(_marketingFee)
        .add(_stakingFee);
        feeDenominator = _feeDenominator;
        require(
            totalFee < feeDenominator / 4,
            "Total fee should not be greater than 1/4 of fee denominator"
        );
    }


    function setFeeReceivers(
        address _autoLiquidityReceiver,
        address _marketingFeeReceiver,
        address _stakingFeeReceiver
    )
    external
    authorized
    {
        autoLiquidityReceiver = _autoLiquidityReceiver;
        marketingFeeReceiver = _marketingFeeReceiver;
        stakingFeeReceiver = _stakingFeeReceiver;
    }


    function setSwapBackSettings(
        bool _enabled,
        uint256 _amount
    )
    external
    authorized
    {
        swapEnabled = _enabled;
        swapThreshold = _amount;
    }



    function getCirculatingSupply()
    public
    view
    returns (uint256)
    {
        return _totalSupply.sub(balanceOf(DEAD)).sub(balanceOf(ZERO));
    }

}
