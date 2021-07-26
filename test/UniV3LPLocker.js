const { waffle, ethers } = require('hardhat')
const { constants, BigNumber, utils } = require('ethers')
const { expect } = require('chai');
const bn = require('bignumber.js')
const FACTORY = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json')
const WETH9  = require('./contracts/WETH9.json')
const { bytecode } = require('@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json')
const { abi: abiPool } = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json')

const POOL_BYTECODE_HASH = utils.keccak256(bytecode);
bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

const FeeAmount = {
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000,
}

const TICK_SPACINGS = {
  500: 10,
  3000: 60,
  10000: 200
}

describe('UniswapV3LPLocker', async () => {

  let factory, nft, weth9, router, tokens, nftDescriptor, wallet, other, uniswapLPLocker;

  before(async () => {
    
    let wallets = await ethers.getSigners();
    [wallet, other] = wallets

    factory = (await waffle.deployContract(wallet, {
      bytecode: FACTORY.bytecode,
      abi: FACTORY.abi,
    }));

    weth9 = (await waffle.deployContract(wallet, {
      bytecode: WETH9.bytecode,
      abi: WETH9.abi,
    }));

    router = (await (await ethers.getContractFactory('MockTimeSwapRouter')).deploy(
      factory.address,
      weth9.address
    ))

    const tokenFactory = await ethers.getContractFactory('TestERC20')

    tokens = new Array();
    tokens = [
      (await tokenFactory.deploy(constants.MaxUint256.div(2))),
      (await tokenFactory.deploy(constants.MaxUint256.div(2))),
      (await tokenFactory.deploy(constants.MaxUint256.div(2)))
    ]

    const nftDescriptorLibraryFactory = await ethers.getContractFactory('NFTDescriptor')
    const nftDescriptorLibrary = await nftDescriptorLibraryFactory.deploy()
    const positionDescriptorFactory = await ethers.getContractFactory('NonfungibleTokenPositionDescriptor', {
      libraries: {
        NFTDescriptor: nftDescriptorLibrary.address,
      },
    })
    nftDescriptor = (await positionDescriptorFactory.deploy(
      tokens[0].address
    )) 

    const positionManagerFactory = await ethers.getContractFactory('MockTimeNonfungiblePositionManager')
    nft = (await positionManagerFactory.deploy(
      factory.address,
      weth9.address,
      nftDescriptor.address
    ))

    let uniswapLPLockerC = await ethers.getContractFactory('UniV3LPLocker')
    uniswapLPLocker = await uniswapLPLockerC.deploy(nft.address, factory.address)

    // approve & fund wallets
    for (const token of tokens) {
      await token.approve(nft.address, constants.MaxUint256)
      await token.connect(wallet).approve(nft.address, constants.MaxUint256)
      await token.transfer(wallet.address, BigNumber.from(1_000_000).mul(BigNumber.from(10).pow(18)))
    }  
  })


  it('creates the pool at the expected address', async () => {
    const expectedAddress = computePoolAddress(
      factory.address,
      [tokens[0].address, tokens[1].address],
      FeeAmount.MEDIUM
    );

    const code = await ethers.provider.getCode(expectedAddress)
    expect(code).to.eq('0x')
    await nft.createAndInitializePoolIfNecessary(
      tokens[0].address,
      tokens[1].address,
      FeeAmount.MEDIUM,
      encodePriceSqrt(1, 1)
    )
    const codeAfter = await ethers.provider.getCode(expectedAddress)
    expect(codeAfter).to.not.eq('0x')
  })


  it('creates a LP NFT token', async () => {
    await nft.createAndInitializePoolIfNecessary(
      tokens[0].address,
      tokens[1].address,
      FeeAmount.MEDIUM,
      encodePriceSqrt(1, 1)
    )

    await nft.mint({
      token0: tokens[0].address,
      token1: tokens[1].address,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      fee: FeeAmount.MEDIUM,
      recipient: other.address,
      amount0Desired: 15,
      amount1Desired: 15,
      amount0Min: 0,
      amount1Min: 0,
      deadline: 10,
    })
    expect(await nft.balanceOf(other.address)).to.eq(1)
    expect(await nft.tokenOfOwnerByIndex(other.address, 0)).to.eq(1)
    const {
      fee,
      token0,
      token1,
      tickLower,
      tickUpper,
      liquidity,
      tokensOwed0,
      tokensOwed1,
      feeGrowthInside0LastX128,
      feeGrowthInside1LastX128,
    } = await nft.positions(1)
    expect(token0).to.eq(tokens[0].address)
    expect(token1).to.eq(tokens[1].address)
    expect(fee).to.eq(FeeAmount.MEDIUM)
    expect(tickLower).to.eq(getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
    expect(tickUpper).to.eq(getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]))
    expect(liquidity).to.eq(15)
    expect(tokensOwed0).to.eq(0)
    expect(tokensOwed1).to.eq(0)
    expect(feeGrowthInside0LastX128).to.eq(0)
    expect(feeGrowthInside1LastX128).to.eq(0)

  });

  it('Approve NFT to Locker contract', async () => {

    await nft.connect(other).approve(uniswapLPLocker.address, 1);

    expect(await nft.getApproved(1)).to.eq(uniswapLPLocker.address);

  });

  it('Lock LP in Locker contract - should mint double amount0 ERC20 token', async () => {

    let lockTx = await uniswapLPLocker.connect(other).lockNFTLp(1)

    const poolAddress = computePoolAddress(
      factory.address,
      [tokens[0].address, tokens[1].address],
      FeeAmount.MEDIUM
    )
    const pool = new ethers.Contract(poolAddress, abiPool, wallet)
    const{sqrtPriceX96} = await pool.slot0();

    const { tickLower, tickUpper,liquidity } = await nft.positions(1)

    let {amount0} = await uniswapLPLocker.checkLiquidityAmounts(sqrtPriceX96, tickLower, tickUpper, liquidity)
    
    amount0 = amount0.toString()
    let expectedERC20ToMint = new bn(amount0).multipliedBy(2).toFixed();

    expect(lockTx)
      .to.emit(uniswapLPLocker, "LiquidityLocked")
      .withArgs(other.address, 1, amount0, expectedERC20ToMint);

    expect(lockTx)
      .to.emit(uniswapLPLocker, "Transfer")
      .withArgs("0x0000000000000000000000000000000000000000", other.address, expectedERC20ToMint);

  })

  

})

function computePoolAddress(factoryAddress, [tokenA, tokenB], fee) {
  const [token0, token1] = tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA]
  const constructorArgumentsEncoded = utils.defaultAbiCoder.encode(
    ['address', 'address', 'uint24'],
    [token0, token1, fee]
  )
  const create2Inputs = [
    '0xff',
    factoryAddress,
    // salt
    utils.keccak256(constructorArgumentsEncoded),
    // init code hash
    POOL_BYTECODE_HASH,
  ]
  const sanitizedInputs = `0x${create2Inputs.map((i) => i.slice(2)).join('')}`
  return utils.getAddress(`0x${utils.keccak256(sanitizedInputs).slice(-40)}`)
}


function encodePriceSqrt(reserve1, reserve0) {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  )
}

const getMinTick = (tickSpacing) => Math.ceil(-887272 / tickSpacing) * tickSpacing
const getMaxTick = (tickSpacing) => Math.floor(887272 / tickSpacing) * tickSpacing