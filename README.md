Smart contract which locks Uniswap Liquidity NFT token and issue ERC20 token in return.

## Installation

```bash
npm install
```

## Run Tests

```bash
npx hardhat test
```

Expected output:

```
  UniswapV3LPLocker
    ✓ creates the pool at the expected address (93ms)
    ✓ creates a LP NFT token (384ms)
    ✓ Approve NFT to Locker contract (39ms)
    ✓ Lock LP in Locker contract - should mint double amount0 ERC20 token (108ms)


  4 passing (4s)
```