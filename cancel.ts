import {AnchorWallet} from "@solana/wallet-adapter-react";
import { BN, web3 } from '@project-serum/anchor';
import {AuctionHouseAccount, CancelResponse, Txn} from "./helpers/types";
import {getAtaForMint, getAuctionHouseTradeState, getPriceWithMantissa} from "./helpers/helpers";
import {TOKEN_PROGRAM_ID} from "./helpers/constants";
import {sendTransactionWithRetryWithKeypair} from "./helpers/transactions";
import * as anchor from "@project-serum/anchor";

export const cancel = async(
    auctionHouse: AuctionHouseAccount,
    userWallet: AnchorWallet | undefined,
    nft: anchor.web3.PublicKey,
    buyPrice: number
): Promise<CancelResponse> => {

    const tokenSize = 1;
    const auctionHouseKey = auctionHouse.id;
    const anchorProgram = auctionHouse.program;
    const auctionHouseObj = auctionHouse.state;

    const buyPriceAdjusted = new BN(
        await getPriceWithMantissa(
            buyPrice,
            auctionHouseObj.treasuryMint,
            userWallet,
            anchorProgram,
        ),
    );

    const tokenSizeAdjusted = new BN(
        await getPriceWithMantissa(
            tokenSize,
            nft,
            userWallet,
            anchorProgram,
        ),
    );

    const tokenAccountKey = await getAtaForMint(nft, userWallet!.publicKey);

    const tradeState = (
        await getAuctionHouseTradeState(
            auctionHouseKey,
            userWallet!.publicKey,
            tokenAccountKey,
            auctionHouseObj.treasuryMint,
            nft,
            tokenSizeAdjusted,
            buyPriceAdjusted,
        )
    )[0];

    // console.log('Trade State: ')
    // console.log(tradeState.toBase58());

    const signers: any[] = [];

    const instruction = await anchorProgram.instruction.cancel(
        buyPriceAdjusted,
        tokenSizeAdjusted,
        {
            accounts: {
                wallet: userWallet!.publicKey,
                tokenAccount: tokenAccountKey,
                tokenMint: nft,
                authority: auctionHouseObj.authority,
                auctionHouse: auctionHouseKey,
                auctionHouseFeeAccount: auctionHouseObj.auctionHouseFeeAccount,
                tradeState,
                tokenProgram: TOKEN_PROGRAM_ID,
            },
            signers,
        },
    );

    instruction.keys
        .filter((k) => k.pubkey.equals(userWallet.publicKey))
        .map((k) => (k.isSigner = true));

    const txData: Txn = await sendTransactionWithRetryWithKeypair(
        anchorProgram.provider.connection,
        userWallet,
        [instruction],
        signers,
        'max',
    );

    const cancelResponse: CancelResponse = {
        txn: txData.txid,
        seller_wallet: userWallet?.publicKey.toBase58(),
        mint: nft.toBase58(),
        price: buyPrice,
        auction_house: auctionHouseKey.toBase58(),
        error: txData.error
    }
    return cancelResponse;
}