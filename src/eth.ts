import {createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits} from 'viem'
import {mainnet} from 'viem/chains'
import { encodeDeployData } from 'viem/utils'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config"

type Address = `0x${string}`

const ETH_FACTORY_ADDRESS = "0x1097053Fd2ea711dad45caCcc45EfF7548fCB362";
const ETH_ROUTER_ADDRESS = "0xEfF92A263d31888d860bD50809A8D171709b7b1c";
const ETH_WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const ETH_RPC = "https://ethereum-rpc.publicnode.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as Address;
const PUBLIC_KEY = "0xACD0BD350355336c5537dE56250Ef01eD61e73eB"

const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({
    chain: mainnet,
    transport: http(ETH_RPC),
})

const client = createWalletClient({
    account,
    chain: mainnet,
    transport: http(ETH_RPC),
})

const ARTIFACTS_PATH = "./artifacts/contracts/exchange-protocol/contracts/";

export async function estimateGasForEth() {
    console.log("TCO FOR ETH\n\n")

    const factoryContractPath = path.join(ARTIFACTS_PATH, "PancakeFactory.sol/PancakeFactory.json")
    const factoryContractArtifact = await fs.readFile(factoryContractPath, "utf-8")

    const factoryContract = JSON.parse(factoryContractArtifact);

    const factoryContractAbi = factoryContract["abi"];
    const factoryContractBytecode = factoryContract["bytecode"];

    const deployFactoryData = encodeDeployData({
        abi: factoryContractAbi,
        bytecode: factoryContractBytecode,
        args: [PUBLIC_KEY],
    })

    const deployFactoryEstimatedGas = await publicClient.estimateGas({
        account,
        data: deployFactoryData,
    })

    console.log("deploy factory gas estimate: ", formatUnits(deployFactoryEstimatedGas, 18))

    //The pair must not exist to estimate the gas needed for its creation.
    const TOKEN_1_ADDRESS = "0x8236a87084f8B84306f72007F36F2618A5634494"
    const TOKEN_2_ADDRESS = "0x4a220E6096B25EADb88358cb44068A3248254675"

    const createPairEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: factoryContractAbi,
        address: ETH_FACTORY_ADDRESS,
        functionName: 'createPair',
        args: [TOKEN_1_ADDRESS, TOKEN_2_ADDRESS]
    });

    console.log("create pair gas estimate: ", formatUnits(createPairEstimatedGas, 18));

    const routerContractPath = path.join(ARTIFACTS_PATH, "PancakeRouter.sol/PancakeRouter.json")
    const routerContractArtifact = await fs.readFile(routerContractPath, "utf-8")

    const routerContract = JSON.parse(routerContractArtifact);

    const routerContractAbi = routerContract["abi"];
    const routerContractBytecode = routerContract["bytecode"];

    const deployRouterData = encodeDeployData({
        abi: routerContractAbi,
        bytecode: routerContractBytecode,
        args: [ETH_FACTORY_ADDRESS, ETH_WETH_ADDRESS],
    })

    const deployRouterEstimatedGas = await publicClient.estimateGas({
        account,
        data: deployRouterData,
    });

    console.log("deploy router gas estimate: ", formatUnits(deployRouterEstimatedGas, 18) )

    //The pair must exist to test the swap
    const SWAP_TOKEN_1_ADDRESS = "0x514910771AF9Ca656af840dff83E8264EcF986CA"
    const SWAP_TOKEN_2_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"

    //Values must be correct
    const amountIn = parseUnits('0.1', 18);
    const amountOutMin = parseUnits('1.3', 6);
    const swapPath = [SWAP_TOKEN_1_ADDRESS, SWAP_TOKEN_2_ADDRESS];

    const approveResult = await client.writeContract({
        address: SWAP_TOKEN_1_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [ETH_ROUTER_ADDRESS, amountIn]
    })

    const approveRx = await publicClient.waitForTransactionReceipt({ hash: approveResult, confirmations: 3 });

    console.log("token approve gas used: ", formatUnits(approveRx.gasUsed, 18))

    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    const callSwapEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: routerContractAbi,
        address: ETH_ROUTER_ADDRESS,
        functionName: 'swapExactTokensForTokens',
        args: [
            amountIn,
            amountOutMin,
            swapPath,
            PUBLIC_KEY,
            deadline
        ]
    });

    console.log("swap tokens gas estimate: ", formatUnits(callSwapEstimatedGas, 18));

    const totalGasBigInt = deployFactoryEstimatedGas + createPairEstimatedGas + deployRouterEstimatedGas + approveRx.gasUsed + callSwapEstimatedGas;
    const totalGas = formatUnits(totalGasBigInt, 18);

    console.log(`TCO (Swap Tokens): ${totalGas}`)
}

estimateGasForEth().catch(console.error);