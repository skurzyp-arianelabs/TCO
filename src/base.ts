import {createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseUnits} from 'viem'
import {base} from 'viem/chains'
import { encodeDeployData } from 'viem/utils'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config"

type Address = `0x${string}`

const BASE_FACTORY_ADDRESS = "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E";
const BASE_ROUTER_ADDRESS = "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb";
const BASE_WETH_ADDRESS = "0x4200000000000000000000000000000000000006"
const BASE_RPC = "https://base.drpc.org"
const PRIVATE_KEY = process.env.PRIVATE_KEY as Address;
const PUBLIC_KEY = "0xACD0BD350355336c5537dE56250Ef01eD61e73eB"

const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({
    chain: base,
    transport: http(BASE_RPC),
})

const client = createWalletClient({
    account,
    chain: base,
    transport: http(BASE_RPC),
})

const ARTIFACTS_PATH = "./artifacts/contracts/exchange-protocol/contracts/";

export async function estimateGasForBase() {
    console.log("TCO FOR BASE\n\n")

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
    const TOKEN_1_ADDRESS = "0xA202B2b7B4D2fe56BF81492FFDDA657FE512De07"
    const TOKEN_2_ADDRESS = "0xc1512B7023A97d54f8Dd757B1F84e132297CA0D7"

    const createPairEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: factoryContractAbi,
        address: BASE_FACTORY_ADDRESS,
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
        args: [BASE_FACTORY_ADDRESS, BASE_WETH_ADDRESS],
    })

    const deployRouterEstimatedGas = await publicClient.estimateGas({
        account,
        data: deployRouterData,
    });

    console.log("deploy router gas estimate: ", formatUnits(deployRouterEstimatedGas, 18) )

    //The pair must exist to test the swap
    const SWAP_TOKEN_1_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    const SWAP_TOKEN_2_ADDRESS = "0x4200000000000000000000000000000000000006"

    //Values must be correct
    const amountIn = parseUnits('0.1', 6);
    const amountOutMin = parseUnits('0.00003', 18);
    const swapPath = [SWAP_TOKEN_1_ADDRESS, SWAP_TOKEN_2_ADDRESS];

    const approveResult = await client.writeContract({
        address: SWAP_TOKEN_1_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [BASE_ROUTER_ADDRESS, amountIn]
    })

    const approveRx = await publicClient.waitForTransactionReceipt({ hash: approveResult, confirmations: 1 });

    console.log("token approve gas used: ", formatUnits(approveRx.gasUsed, 18))

    const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

    const callSwapEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: routerContractAbi,
        address: BASE_ROUTER_ADDRESS,
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

estimateGasForBase().catch(console.error);