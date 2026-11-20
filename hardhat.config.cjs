require('@nomicfoundation/hardhat-ethers');
require('@nomicfoundation/hardhat-chai-matchers');
const path = require('path');
const { subtask } = require('hardhat/config');
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require('hardhat/builtin-tasks/task-names');

// Use the solc bundled from npm instead of downloading one (works offline).
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === '0.8.24') {
    return {
      compilerPath: path.join(__dirname, 'node_modules', 'solc', 'soljson.js'),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: require('solc/package.json').version,
    };
  }
  return runSuper();
});

module.exports = {
  networks: { hardhat: { chainId: 5042002 } },
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'cancun' },
  },
};
