import {createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits} from 'viem'
import {arbitrum, bsc} from 'viem/chains'
import { encodeDeployData } from 'viem/utils'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config"

type Address = `0x${string}`

const ARBITRUM_FACTORY_ADDRESS = "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E";
const ARBITRUM_ROUTER_ADDRESS = "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb";
const ARBITRUM_WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
const ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc"
const PRIVATE_KEY = process.env.PRIVATE_KEY as Address;
const PUBLIC_KEY = "0xACD0BD350355336c5537dE56250Ef01eD61e73eB"

const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(ARBITRUM_RPC),
})

const client = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(ARBITRUM_RPC),
})

const ARTIFACTS_PATH = "./artifacts/contracts/exchange-protocol/contracts/";

export async function estimateGasForBNB() {
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

    const TOKEN_1_ADDRESS = "0xCBeb19549054CC0a6257A77736FC78C367216cE7"
    const TOKEN_2_ADDRESS = "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00"

    const createPairEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: factoryContractAbi,
        address: ARBITRUM_FACTORY_ADDRESS,
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
        args: [ARBITRUM_FACTORY_ADDRESS, ARBITRUM_WETH_ADDRESS],
    })

    const deployRouterEstimatedGas = await publicClient.estimateGas({
        account,
        data: deployRouterData,
    });

    console.log("deploy router gas estimate: ", formatUnits(deployRouterEstimatedGas, 18) )

    const SWAP_TOKEN_1_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
    const SWAP_TOKEN_2_ADDRESS = "0x912CE59144191C1204E64559FE8253a0e49E6548"

    const amountIn = parseUnits('0.1', 6);
    const amountOutMin = parseUnits('0.26', 18);
    const swapPath = [SWAP_TOKEN_1_ADDRESS, SWAP_TOKEN_2_ADDRESS];

    const approveResult = await client.writeContract({
        address: SWAP_TOKEN_1_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [ARBITRUM_ROUTER_ADDRESS, amountIn]
    })

    const approveRx = await publicClient.waitForTransactionReceipt({ hash: approveResult, confirmations: 1 });

    console.log("token approve gas used: ", formatUnits(approveRx.gasUsed, 18))

    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    const callSwapEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: routerContractAbi,
        address: ARBITRUM_ROUTER_ADDRESS,
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

estimateGasForBNB().catch(console.error);