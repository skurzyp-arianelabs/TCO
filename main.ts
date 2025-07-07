import {createPublicClient, createWalletClient, formatUnits, http, parseEther} from 'viem'
import {bsc} from 'viem/chains'
import { encodeDeployData } from 'viem/utils'
import { privateKeyToAccount } from 'viem/accounts'
import * as fs from "node:fs/promises";
import path from "node:path";
import "dotenv/config"

type Address = `0x${string}`

const BNB_FACTORY_ADDRESS = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const BNB_RPC = "https://bsc-rpc.publicnode.com"
const PRIVATE_KEY = process.env.PRIVATE_KEY as Address;
const PUBLIC_KEY = "0xACD0BD350355336c5537dE56250Ef01eD61e73eB"

const account = privateKeyToAccount(PRIVATE_KEY)

const publicClient = createPublicClient({
    chain: bsc,
    transport: http(BNB_RPC),
})

const client = createWalletClient({
    account,
    chain: bsc,
    transport: http(BNB_RPC),
})

const ARTIFACTS_PATH = "./artifacts/contracts/exchange-protocol/contracts/";

async function estimateSwapContractsGas() {
    const routerContractPath = path.join(ARTIFACTS_PATH, "PancakeFactory.sol/PancakeFactory.json")
    const routerContractArtifact = await fs.readFile(routerContractPath, "utf-8")

    const routerContract = JSON.parse(routerContractArtifact);

    const routerContractAbi = routerContract["abi"];
    const routerContractBytecode = routerContract["bytecode"];

    const deployData = encodeDeployData({
        abi: routerContractAbi,
        bytecode: routerContractBytecode,
        args: [PUBLIC_KEY],
    })

    const deployEstimatedGas = await publicClient.estimateGas({
        account,
        data: deployData,
    })

    console.log("deploy gas estimate: ", formatUnits(deployEstimatedGas, 18))

    const TOKEN_1_ADDRESS = "0x9D173E6c594f479B4d47001F8E6A95A7aDDa42bC"
    const TOKEN_2_ADDRESS = "0xfb5B838b6cfEEdC2873aB27866079AC55363D37E"

    const createPairEstimatedGas = await publicClient.estimateContractGas({
        account,
        abi: routerContractAbi,
        address: BNB_FACTORY_ADDRESS,
        functionName: 'createPair',
        args: [TOKEN_1_ADDRESS, TOKEN_2_ADDRESS]
    });

    console.log("create pair gas estimate: ", formatUnits(createPairEstimatedGas, 18));
}

estimateSwapContractsGas().catch(console.error)