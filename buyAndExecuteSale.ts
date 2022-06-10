import {BN, web3} from '@project-serum/anchor';
import {AnchorWallet} from "@solana/wallet-adapter-react";
import {ASSOCIATED_TOKEN_PROGRAM_ID, Token} from "@solana/spl-token";
import {AuctionHouseAccount, BuyAndExecuteSaleResponse, InstructionsAndSignersSet, Metadata} from "./helpers/types";
import {
    decodeMetadata,
    getAtaForMint,
    getAuctionHouseBuyerEscrow, getAuctionHouseProgramAsSigner,
    getAuctionHouseTradeState, getMetadata,
    getPriceWithMantissa
} from "./helpers/helpers";
import {TOKEN_PROGRAM_ID, WRAPPED_SOL_MINT} from "./helpers/constants";
import {sendTransactionWithRetryWithKeypair} from "./helpers/transactions";
import * as anchor from "@project-serum/anchor";



export const buyInstructions = async (
    auctionHouse: AuctionHouseAccount,
    userWallet: AnchorWallet | undefined,
    nft: anchor.web3.PublicKey,
    buyPrice: number
): Promise<InstructionsAndSignersSet> => {
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

    const [escrowPaymentAccount, escrowBump] = await getAuctionHouseBuyerEscrow(
        auctionHouseKey,
        userWallet!.publicKey,
    );

    const results = await anchorProgram.provider.connection.getTokenLargestAccounts(nft);

    const tokenAccountKey: web3.PublicKey = results.value[0].address;

    const [tradeState, tradeBump] = await getAuctionHouseTradeState(
        auctionHouseKey,
        userWallet!.publicKey,
        tokenAccountKey,
        auctionHouseObj.treasuryMint,
        nft,
        tokenSizeAdjusted,
        buyPriceAdjusted,
    );

    const isNative = auctionHouseObj.treasuryMint.equals(WRAPPED_SOL_MINT);

    const ata = await getAtaForMint(
        auctionHouseObj.treasuryMint,
        userWallet!.publicKey,
    );

    const transferAuthority = web3.Keypair.generate();
    const signers = isNative ? [] : [transferAuthority];
    const instruction = await anchorProgram.instruction.buy(
        tradeBump,
        escrowBump,
        buyPriceAdjusted,
        tokenSizeAdjusted,
        {
            accounts: {
                wallet: userWallet!.publicKey,
                paymentAccount: isNative ? userWallet!.publicKey : ata,
                transferAuthority: isNative
                    ? web3.SystemProgram.programId
                    : transferAuthority.publicKey,
                metadata: await getMetadata(nft),
                tokenAccount: tokenAccountKey,
                escrowPaymentAccount,
                treasuryMint: auctionHouseObj.treasuryMint,
                authority: auctionHouseObj.authority,
                auctionHouse: auctionHouseKey,
                auctionHouseFeeAccount: auctionHouseObj.auctionHouseFeeAccount,
                buyerTradeState: tradeState,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: web3.SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            },
        },
    );

    if (!isNative) {
        instruction.keys
            .filter(k => k.pubkey.equals(transferAuthority.publicKey))
            .map(k => (k.isSigner = true));
    }

    const instructions = [
        ...(isNative
            ? []
            : [
                Token.createApproveInstruction(
                    TOKEN_PROGRAM_ID,
                    ata,
                    transferAuthority.publicKey,
                    userWallet!.publicKey,
                    [],
                    buyPriceAdjusted.toNumber(),
                ),
            ]),

        instruction,
        ...(isNative
            ? []
            : [
                Token.createRevokeInstruction(
                    TOKEN_PROGRAM_ID,
                    ata,
                    userWallet!.publicKey,
                    [],
                ),
            ]),
    ];

    return {
        signers: signers,
        instructions: instructions
    }
}


export const executeSale = async (
    auctionHouse: AuctionHouseAccount,
    userWallet: AnchorWallet | undefined,
    nft: anchor.web3.PublicKey,
    buyPrice: number,
    buyerWalletPubKey: anchor.web3.PublicKey,
    sellerWalletPubKey: anchor.web3.PublicKey
): Promise<any> => {

    const tokenSize = 1;
    const auctionHouseKey = auctionHouse.id;
    const anchorProgram = auctionHouse.program;
    const auctionHouseObj = auctionHouse.state;

    const isNative = auctionHouseObj.treasuryMint.equals(WRAPPED_SOL_MINT);
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

    const tokenAccountKey = await getAtaForMint(nft, sellerWalletPubKey);

    const buyerTradeState = (
        await getAuctionHouseTradeState(
            auctionHouseKey,
            buyerWalletPubKey,
            tokenAccountKey,
            auctionHouseObj.treasuryMint,
            nft,
            tokenSizeAdjusted,
            buyPriceAdjusted,
        )
    )[0];

    const sellerTradeState = (
        await getAuctionHouseTradeState(
            auctionHouseKey,
            sellerWalletPubKey,
            tokenAccountKey,
            auctionHouseObj.treasuryMint,
            nft,
            tokenSizeAdjusted,
            buyPriceAdjusted,
        )
    )[0];

    const [freeTradeState, freeTradeStateBump] =
        await getAuctionHouseTradeState(
            auctionHouseKey,
            sellerWalletPubKey,
            tokenAccountKey,
            auctionHouseObj.treasuryMint,
            nft,
            tokenSizeAdjusted,
            new BN(0),
        );
    const [escrowPaymentAccount, bump] = await getAuctionHouseBuyerEscrow(
        auctionHouseKey,
        buyerWalletPubKey,
    );
    const [programAsSigner, programAsSignerBump] = await getAuctionHouseProgramAsSigner();
    const metadata = await getMetadata(nft);

    const metadataObj = await anchorProgram.provider.connection.getAccountInfo(metadata,);
    const metadataDecoded: Metadata = decodeMetadata(
        Buffer.from(metadataObj.data),
    );

    const remainingAccounts = [];

    for (let i = 0; i < metadataDecoded.data.creators.length; i++) {
        remainingAccounts.push({
            pubkey: new web3.PublicKey(metadataDecoded.data.creators[i].address),
            isWritable: true,
            isSigner: false,
        });
        if (!isNative) {
            remainingAccounts.push({
                pubkey: await getAtaForMint(
                    auctionHouseObj.treasuryMint,
                    remainingAccounts[remainingAccounts.length - 1].pubkey
                ),
                isWritable: true,
                isSigner: false,
            });
        }
    }
    const signers: any[] = [];
    const tMint: web3.PublicKey = auctionHouseObj.treasuryMint;

    const instruction = await anchorProgram.instruction.executeSale(
        bump,
        freeTradeStateBump,
        programAsSignerBump,
        buyPriceAdjusted,
        tokenSizeAdjusted,
        {
            accounts: {
                buyer: buyerWalletPubKey,
                seller: sellerWalletPubKey,
                metadata,
                tokenAccount: tokenAccountKey,
                tokenMint: nft,
                escrowPaymentAccount,
                treasuryMint: tMint,
                sellerPaymentReceiptAccount: isNative
                    ? sellerWalletPubKey
                    : await getAtaForMint(tMint, sellerWalletPubKey),
                buyerReceiptTokenAccount: await getAtaForMint(nft, buyerWalletPubKey),
                authority: auctionHouseObj.authority,
                auctionHouse: auctionHouseKey,
                auctionHouseFeeAccount: auctionHouseObj.auctionHouseFeeAccount,
                auctionHouseTreasury: auctionHouseObj.auctionHouseTreasury,
                sellerTradeState,
                buyerTradeState,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: web3.SystemProgram.programId,
                ataProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                programAsSigner,
                rent: web3.SYSVAR_RENT_PUBKEY,
                freeTradeState,
            },
            remainingAccounts,
            signers,
        },
    );

    return {
        signers: signers,
        instructions: [instruction]
    }
}

export const buyAndExecuteSale = async(
    auctionHouse: AuctionHouseAccount,
    userWallet: AnchorWallet | undefined,
    nft: anchor.web3.PublicKey,
    buyPrice: number,
    buyerWalletPubKey: anchor.web3.PublicKey,
    sellerWalletPubKey: anchor.web3.PublicKey
): Promise<BuyAndExecuteSaleResponse> => {
    const auctionHouseKey = auctionHouse.id;
    const anchorProgram = auctionHouse.program;

    const buyInstructionsArray = await buyInstructions(auctionHouse, userWallet, nft, buyPrice);
    const executeSaleInstructionArray = await executeSale(auctionHouse, userWallet, nft, buyPrice, buyerWalletPubKey, sellerWalletPubKey);
    const instructionsArray = [buyInstructionsArray.instructions, executeSaleInstructionArray.instructions].flat();
    const signersArray = [buyInstructionsArray.signers, executeSaleInstructionArray.signers].flat();

    const txData = await sendTransactionWithRetryWithKeypair(
        anchorProgram.provider.connection,
        userWallet,
        instructionsArray,
        signersArray,
        'max',
    );

    let buyAndExecuteSaleResponse: BuyAndExecuteSaleResponse = {
        txn: txData.txid,
        buyer_wallet: buyerWalletPubKey.toBase58(),
        seller_wallet: sellerWalletPubKey.toBase58(),
        mint: nft.toBase58(),
        price: buyPrice,
        auction_house: auctionHouseKey.toBase58(),
        error: txData.error
    }
    return buyAndExecuteSaleResponse;
}