require('dotenv').config()
let distributor = process.env.ASET_DISTRIBUTOR

async function main() {
    const MoonFlight = await ethers.getContractFactory("MoonFlight");
    console.log("Deploying MoonFlight...");
    const moonflight = await MoonFlight.deploy();
    console.log("MoonFlight deployed to:", moonflight.address);
  }
  
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });