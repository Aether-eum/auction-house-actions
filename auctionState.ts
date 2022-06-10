import * as anchor from '@project-serum/anchor';
import { AnchorWallet } from "@solana/wallet-adapter-react";
import {AuctionHouseAccount} from "./helpers/types";

export const AUCTION_HOUSE_MACHINE_PROGRAM = new anchor.web3.PublicKey(
    'hausS13jsjafwWwGqZTUQRmWyvyxn9EQpqMwV1PBBmk',
);

export const getAuctionHouseState = async (
    anchorWallet: AnchorWallet,
    auctionHouseId: anchor.web3.PublicKey,
    connection: anchor.web3.Connection,
): Promise<AuctionHouseAccount> => {
    const provider = new anchor.Provider(connection, anchorWallet, {
        preflightCommitment: 'processed',
    });

    const idl = await anchor.Program.fetchIdl(AUCTION_HOUSE_MACHINE_PROGRAM, provider);

    const program = new anchor.Program(idl!, AUCTION_HOUSE_MACHINE_PROGRAM, provider);

    const state: any = await program.account.auctionHouse.fetch(auctionHouseId);

    return {
        id: auctionHouseId,
        program,
        state: {
            auctionHouseFeeAccount: state.auctionHouseFeeAccount,
            auctionHouseTreasury: state.auctionHouseTreasury,
            authority: state.authority,
            bump: state.bump,
            canChangeSalePrice: state.canChangeSalePrice,
            creator: state.creator,
            feePayerBump: state.feePayerBump,
            feeWithdrawalDestination: state.feeWithdrawalDestination,
            requiresSignOff: state.requiresSignOff,
            sellerFeeBasisPoints: state.sellerFeeBasisPoints,
            treasuryBump: state.treasuryBump,
            treasuryMint: state.treasuryMint,
            treasuryWithdrawalDestination: state.treasuryWithdrawalDestination
        },
    };
};

