// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0;

import '@openzeppelin/contracts/math/SafeMath.sol';
import '@uniswap/v3-core/contracts/libraries/TickMath.sol';
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import '@uniswap/v3-core/contracts/libraries/FixedPoint96.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol';
import '@uniswap/v3-periphery/contracts/libraries/PoolAddress.sol';
import '@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol';
import '@uniswap/v3-periphery/contracts/interfaces/IERC20Metadata.sol';
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';


contract UniV3LPLocker is ERC20("Liquidity ERC20", "LQT"){
    using SafeMath for uint256;

    // address public constant NFT_POSITION_MANAGER = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88; // Address of Uniswap NonfungiblePositionManager Contract
    // address public constant factoryV3 = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    


    address public NFT_POSITION_MANAGER; // Address of Uniswap NonfungiblePositionManager Contract
    address public factoryV3;
    
    constructor(address nft, address factory){
        NFT_POSITION_MANAGER = nft;
        factoryV3 = factory;
    }
    
    event LiquidityLocked(address indexed user, uint256 tokenId, uint256 amount0, uint256 mintAmount);
    
    // @notice User should approve/permit their NFT to this contract to spend NFT before calling this funciton
    // @param _tokenId NFT LP tokenID
    function lockNFTLp(uint256 _tokenId) public{
        
        INonfungiblePositionManager(NFT_POSITION_MANAGER).transferFrom(msg.sender, address(this), _tokenId);
    
        (,,address token0,address token1,uint24 fee,int24 tickLower, int24 tickUper, uint128 liquidity,,,,) = INonfungiblePositionManager(NFT_POSITION_MANAGER).positions(_tokenId);
        
        IUniswapV3Pool pool = IUniswapV3Pool(calculatePoolAddresss(token0, token1, fee));
        
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
 
        (uint256 amount0,) = checkLiquidityAmounts(sqrtPriceX96, tickLower, tickUper, liquidity);
        
        uint256 token0Decimal = IERC20Metadata(token0).decimals();
        
        uint256 amountToMint = amount0.mul(10 ** decimals()).div(10 ** token0Decimal).mul(2);
        
        _mint(msg.sender, amountToMint);
        
        emit LiquidityLocked(msg.sender, _tokenId, amount0, amountToMint);
        
    }
    
    
    function checkLiquidityAmounts(uint160 sqrt, int24 tickLower, int24 tickUper, uint128 liquidity) public pure returns(uint256 amount0, uint256 amount1){
        // calculating amount0 from lp position data
        uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(tickUper);
        
        return LiquidityAmounts.getAmountsForLiquidity(sqrt, sqrtRatioAX96, sqrtRatioBX96, liquidity);
    }
    
    function calculatePoolAddresss(address token0,address token1, uint24 fee) internal view returns(address){
        PoolAddress.PoolKey memory poolKey = PoolAddress.PoolKey({token0: token0, token1: token1, fee: fee});
        return PoolAddress.computeAddress(factoryV3, poolKey);
    }
    
}