import * as anchor from '@project-serum/anchor';
import { AnchorWallet } from "@solana/wallet-adapter-react";
import {
    getAtaForMint,
    getAuctionHouseProgramAsSigner,
    getAuctionHouseTradeState,
    getMetadata,
    getPriceWithMantissa
} from "./helpers/helpers";
import {SellResponse, AuctionHouseAccount} from "./helpers/types";
import {createAssociatedTokenAccountInstruction, getTransferInstructions} from "./helpers/instructions";
import {TOKEN_PROGRAM_ID} from "./helpers/constants";
import { sendTransactionWithRetryWithKeypair } from "./helpers/transactions";


export const createSell = async (
    userWallet: AnchorWallet,
    auctionHouse: AuctionHouseAccount,
    price: number,
    nft: anchor.web3.PublicKey
): Promise<SellResponse> => {
    const tokenSize = 1;

    const auctionHouseKey = auctionHouse.id;

    const anchorProgram = auctionHouse.program;

    const auctionHouseObj = auctionHouse.state;

    const connection = anchorProgram.provider.connection;

    const buyPriceAdjusted = new anchor.BN(
        await getPriceWithMantissa(
            price,
            auctionHouseObj.treasuryMint,
            userWallet,
            anchorProgram,
        ),
    );

    const tokenSizeAdjusted = new anchor.BN(
        await getPriceWithMantissa(
            tokenSize,
            nft,
            userWallet,
            anchorProgram,
        ),
    );

    const largestAccount = (await connection.getTokenLargestAccounts(nft)).value[0];
    const tokenAccountKey = await getAtaForMint(nft, userWallet!.publicKey);
    const instructions = [];
    if (largestAccount.address.toBase58() != tokenAccountKey.toBase58()) {
        const accountInfo = await connection.getParsedAccountInfo(tokenAccountKey);
        if (accountInfo.value === null) {
            instructions.push(createAssociatedTokenAccountInstruction(tokenAccountKey, userWallet!.publicKey, userWallet!.publicKey, nft));
        }
        // @ts-ignore
        if (!accountInfo.value || (accountInfo.value && accountInfo.value.data?.parsed.info.tokenAmount.uiAmount === 0)) {
            instructions.push(getTransferInstructions(largestAccount.address, tokenAccountKey, userWallet!.publicKey));
        }
    }

    const [programAsSigner, programAsSignerBump] = await getAuctionHouseProgramAsSigner();

    const [tradeState, tradeBump] = await getAuctionHouseTradeState(
        auctionHouseKey,
        userWallet!.publicKey,
        tokenAccountKey,
        auctionHouseObj.treasuryMint,
        nft,
        tokenSizeAdjusted,
        buyPriceAdjusted,
    );

    const [freeTradeState, freeTradeBump] = await getAuctionHouseTradeState(
        auctionHouseKey,
        userWallet!.publicKey,
        tokenAccountKey,
        auctionHouseObj.treasuryMint,
        nft,
        tokenSizeAdjusted,
        new anchor.BN(0),
    );

    const signers: anchor.web3.Keypair[] = [];

    const instruction = await anchorProgram.instruction.sell(
        tradeBump,
        freeTradeBump,
        programAsSignerBump,
        buyPriceAdjusted,
        tokenSizeAdjusted,
        {
            accounts: {
                wallet: userWallet!.publicKey,
                metadata: await getMetadata(nft),
                tokenAccount: tokenAccountKey,
                authority: auctionHouseObj.authority,
                auctionHouse: auctionHouseKey,
                auctionHouseFeeAccount: auctionHouseObj.auctionHouseFeeAccount,
                sellerTradeState: tradeState,
                freeSellerTradeState: freeTradeState,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                programAsSigner,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            },
            signers,
        },
    );
    instructions.push(instruction)

    const txData = await sendTransactionWithRetryWithKeypair(
        anchorProgram.provider.connection,
        userWallet,
        instructions,
        signers,
        'max',
    );

    let sellResponse: SellResponse = {
        txn: txData.txid,
        seller_wallet: userWallet?.publicKey.toBase58(),
        mint: nft.toBase58(),
        price: price,
        auction_house: auctionHouseKey.toBase58(),
        status: 'open',
        error: txData.error
    }

    return sellResponse;
};
