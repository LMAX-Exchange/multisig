//! An example of a multisig to execute arbitrary Solana transactions.
//!
//! This program can be used to allow a multisig to govern anything a regular
//! Pubkey can govern. One can use the multisig as a BPF program upgrade
//! authority, a mint authority, etc.
//!
//! To use, one must first create a `Multisig` account, specifying two important
//! parameters:
//!
//! 1. Owners - the set of addresses that sign transactions for the multisig.
//! 2. Threshold - the number of signers required to execute a transaction.
//!
//! Once the `Multisig` account is created, one can create a `Transaction`
//! account, specifying the parameters for a normal solana transaction.
//!
//! To sign, owners should invoke the `approve` instruction, and finally,
//! the `execute_transaction`, once enough (i.e. `threshold`) of the owners have
//! signed.

use anchor_lang::prelude::*;
use anchor_lang::solana_program;
use anchor_lang::solana_program::instruction::Instruction;
use std::convert::Into;


const ANCHOR_ACCT_DESCRIM_SIZE: usize = 8;
const VEC_SIZE: usize = 4;
const PUBKEY_SIZE: usize = 32;

#[macro_export]
macro_rules! vec_len {
    ( $elem_size:expr, $elem_count:expr ) => {
        {
            $elem_size * $elem_count + VEC_SIZE
        }
    };
}

#[macro_export]
macro_rules! instructions_len {
    ( $instructions: expr) => {
        {
            $instructions.iter().map(|ix| {
                PUBKEY_SIZE + vec_len!(PUBKEY_SIZE + 1 + 1, ix.accounts.len()) + vec_len!(1, ix.data.len())
            })
            .sum::<usize>() + VEC_SIZE
        }
    };
}

declare_id!("LMAXm1DhfBg1YMvi79gXdPfsJpYuJb9urGkGNa12hvJ");

#[program]
pub mod lmax_multisig {
    use super::*;

    // Initializes a new multisig account with a set of owners and a threshold.
    pub fn create_multisig(
        ctx: Context<CreateMultisig>,
        owners: Vec<Pubkey>,
        threshold: u64,
        nonce: u8,
    ) -> Result<()> {
        assert_unique_owners(&owners)?;
        require!(
            threshold > 0 && threshold <= owners.len() as u64,
            ErrorCode::InvalidThreshold
        );
        require!(!owners.is_empty(), ErrorCode::NotEnoughOwners);

        let multisig = &mut ctx.accounts.multisig;
        multisig.owners = owners;
        multisig.threshold = threshold;
        multisig.nonce = nonce;
        multisig.owner_set_seqno = 0;
        Ok(())
    }

    // Creates a new transaction account, automatically signed by the creator,
    // which must be one of the owners of the multisig.
    pub fn create_transaction(
        ctx: Context<CreateTransaction>,
        instructions: Vec<TransactionInstruction>,
    ) -> Result<()> {
        require!(!instructions.is_empty(), ErrorCode::MissingInstructions);

        let owner_index = ctx
            .accounts
            .multisig
            .owners
            .iter()
            .position(|a| a == ctx.accounts.proposer.key)
            .ok_or(ErrorCode::InvalidOwner)?;

        let mut signers = Vec::new();
        signers.resize(ctx.accounts.multisig.owners.len(), false);
        signers[owner_index] = true;

        let tx = &mut ctx.accounts.transaction;
        tx.instructions = instructions;
        tx.signers = signers;
        tx.multisig = ctx.accounts.multisig.key();
        tx.owner_set_seqno = ctx.accounts.multisig.owner_set_seqno;

        Ok(())
    }

    // Approves a transaction on behalf of an owner of the multisig.
    pub fn approve(ctx: Context<Approve>) -> Result<()> {
        let owner_index = ctx
            .accounts
            .multisig
            .owners
            .iter()
            .position(|a| a == ctx.accounts.owner.key)
            .ok_or(ErrorCode::InvalidOwner)?;

        ctx.accounts.transaction.signers[owner_index] = true;

        Ok(())
    }

    // Set owners and threshold at once.
    pub fn set_owners_and_change_threshold<'info>(
        ctx: Context<'_, '_, '_, 'info, Auth<'info>>,
        owners: Vec<Pubkey>,
        threshold: u64,
    ) -> Result<()> {
        let multisig = &mut ctx.accounts.multisig;
        execute_set_owners(multisig, owners)?;
        execute_change_threshold(multisig, threshold)
    }

    // Sets the owners field on the multisig. The only way this can be invoked
    // is via a recursive call from execute_transaction -> set_owners.
    pub fn set_owners(ctx: Context<Auth>, owners: Vec<Pubkey>) -> Result<()> {
        execute_set_owners(&mut ctx.accounts.multisig, owners)
    }

    // Changes the execution threshold of the multisig. The only way this can be
    // invoked is via a recursive call from execute_transaction ->
    // change_threshold.
    pub fn change_threshold(ctx: Context<Auth>, threshold: u64) -> Result<()> {
        let multisig = &mut ctx.accounts.multisig;
        execute_change_threshold(multisig, threshold)
    }

    // Executes the given transaction if threshold owners have signed it.
    pub fn execute_transaction(ctx: Context<ExecuteTransaction>) -> Result<()> {
        require!(ctx.accounts.multisig.owners.contains(ctx.accounts.executor.key), ErrorCode::InvalidExecutor);

        // Do we have enough signers?
        let sig_count = ctx.accounts.transaction.signers.iter()
            .filter(|&did_sign| *did_sign)
            .count() as u64;
        require!(sig_count >= ctx.accounts.multisig.threshold, ErrorCode::NotEnoughSigners);

        let multisig_key = ctx.accounts.multisig.key();
        let seeds = &[multisig_key.as_ref(), &[ctx.accounts.multisig.nonce]];
        let signer = &[&seeds[..]];
        let accounts = ctx.remaining_accounts;

        // Execute the transaction signed by the multisig.
        ctx.accounts.transaction.instructions.iter()
            .map(|ix| {
                let mut ix: Instruction = ix.into();
                ix.accounts = ix.accounts.iter()
                    .map(|acc| {
                        let mut acc = acc.clone();
                        if &acc.pubkey == ctx.accounts.multisig_signer.key {
                            acc.is_signer = true;
                        }
                        acc
                    })
                    .collect();
                solana_program::program::invoke_signed(&ix, accounts, signer)
            })
            // Collect will process Result objects from the invoke_signed until it finds an error, when it will return that error
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(())
    }

    // Cancel the given transaction regardless of signatures.
    pub fn cancel_transaction(ctx: Context<CancelTransaction>) -> Result<()> {
        require!(ctx.accounts.multisig.owners.contains(ctx.accounts.executor.key), ErrorCode::InvalidExecutor);
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(owners: Vec<Pubkey>, threshold: u64, nonce: u8)]
pub struct CreateMultisig<'info> {
    // see https://book.anchor-lang.com/anchor_references/space.html
    #[account(
        init,
        space = ANCHOR_ACCT_DESCRIM_SIZE + vec_len!(PUBKEY_SIZE, owners.len()) + 8 + 1 + 4,
        payer = payer,
        signer
    )]
    multisig: Box<Account<'info, Multisig>>,
    /// CHECK: multisig_signer is a PDA program signer. Data is never read or written to
    #[account(
        seeds = [multisig.key().as_ref()],
        bump = nonce,
    )]
    multisig_signer: UncheckedAccount<'info>,
    #[account(mut)]
    payer: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(instructions: Vec<TransactionInstruction>)]
pub struct CreateTransaction<'info> {
    multisig: Box<Account<'info, Multisig>>,
    // see https://book.anchor-lang.com/anchor_references/space.html
    #[account(
        init,
        space = ANCHOR_ACCT_DESCRIM_SIZE + PUBKEY_SIZE + instructions_len!(instructions) + vec_len!(1, multisig.owners.len()) + 1 + 4,
        payer = payer,
        signer
    )]
    transaction: Box<Account<'info, Transaction>>,
    // One of the owners. Checked in the handler.
    proposer: Signer<'info>,
    #[account(mut)]
    payer: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Approve<'info> {
    #[account(constraint = multisig.owner_set_seqno == transaction.owner_set_seqno)]
    multisig: Box<Account<'info, Multisig>>,
    #[account(mut, has_one = multisig)]
    transaction: Box<Account<'info, Transaction>>,
    // One of the multisig owners. Checked in the handler.
    owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Auth<'info> {
    #[account(mut)]
    multisig: Box<Account<'info, Multisig>>,
    #[account(
        seeds = [multisig.key().as_ref()],
        bump = multisig.nonce,
    )]
    multisig_signer: Signer<'info>,
}

#[derive(Accounts)]
pub struct ExecuteTransaction<'info> {
    #[account(constraint = multisig.owner_set_seqno == transaction.owner_set_seqno)]
    multisig: Box<Account<'info, Multisig>>,
    /// CHECK: multisig_signer is a PDA program signer. Data is never read or written to
    #[account(
        seeds = [multisig.key().as_ref()],
        bump = multisig.nonce,
    )]
    multisig_signer: UncheckedAccount<'info>,
    #[account(mut, has_one = multisig, close = refundee)]
    transaction: Box<Account<'info, Transaction>>,
    /// CHECK: success can be any address where rent exempt funds are sent
    #[account(mut)]
    refundee:  AccountInfo<'info>,
    executor: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelTransaction<'info> {
    #[account(constraint = multisig.owner_set_seqno == transaction.owner_set_seqno)]
    multisig: Box<Account<'info, Multisig>>,
    #[account(mut, has_one = multisig, close = refundee)]
    transaction: Box<Account<'info, Transaction>>,
    /// CHECK: success can be any address where rent exempt funds are sent
    #[account(mut)]
    refundee:  AccountInfo<'info>,
    executor: Signer<'info>,
}

#[account]
pub struct Multisig {
    pub owners: Vec<Pubkey>,
    pub threshold: u64,
    pub nonce: u8,
    pub owner_set_seqno: u32,
}

#[account]
pub struct Transaction {
    // The multisig account this transaction belongs to.
    pub multisig: Pubkey,
    // The instructions to be executed by this transaction
    pub instructions: Vec<TransactionInstruction>,
    // signers[index] is true iff multisig.owners[index] signed the transaction.
    pub signers: Vec<bool>,
    // Owner set sequence number.
    pub owner_set_seqno: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransactionInstruction {
    /// Pubkey of the program that executes this instruction.
    pub program_id: Pubkey,
    /// Metadata describing accounts that should be passed to the program.
    pub accounts: Vec<TransactionAccount>,
    /// Opaque data passed to the program for its own interpretation.
    pub data: Vec<u8>,
}

impl From<&TransactionInstruction> for Instruction {
    fn from(ix: &TransactionInstruction) -> Instruction {
        Instruction {
            program_id: ix.program_id,
            accounts: ix.accounts.iter().map(Into::into).collect(),
            data: ix.data.clone(),
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TransactionAccount {
    pub pubkey: Pubkey,
    pub is_signer: bool,
    pub is_writable: bool,
}

impl From<&TransactionAccount> for AccountMeta {
    fn from(account: &TransactionAccount) -> AccountMeta {
        match account.is_writable {
            false => AccountMeta::new_readonly(account.pubkey, account.is_signer),
            true => AccountMeta::new(account.pubkey, account.is_signer),
        }
    }
}

fn assert_unique_owners(owners: &[Pubkey]) -> Result<()> {
    for (i, owner) in owners.iter().enumerate() {
        require!(
            !owners.iter().skip(i + 1).any(|item| item == owner),
            ErrorCode::UniqueOwners
        )
    }
    Ok(())
}

fn execute_set_owners(multisig: &mut Multisig, owners: Vec<Pubkey>) -> Result<()> {
    assert_unique_owners(&owners)?;
    require!(!owners.is_empty(), ErrorCode::NotEnoughOwners);
    // Increasing the number of owners requires reallocation of space in the data account.
    // This requires a signer to pay the fees for more space, but the instruction will be executed by the multisig.
    require!(owners.len() <= multisig.owners.len(), ErrorCode::TooManyOwners);

    if (owners.len() as u64) < multisig.threshold {
        multisig.threshold = owners.len() as u64;
    }

    multisig.owners = owners;
    multisig.owner_set_seqno += 1;

    Ok(())
}

fn execute_change_threshold(multisig: &mut Multisig, threshold: u64) -> Result<()> {
    require!(threshold > 0 && threshold <= multisig.owners.len() as u64, ErrorCode::InvalidThreshold);
    multisig.threshold = threshold;
    Ok(())
}

#[error_code]
pub enum ErrorCode {
    #[msg("The given owner is not part of this multisig.")]
    InvalidOwner,
    #[msg("Owners length must be non zero.")]
    NotEnoughOwners,
    #[msg("The number of owners cannot be increased.")]
    TooManyOwners,
    #[msg("Not enough owners signed this transaction.")]
    NotEnoughSigners,
    #[msg("Cannot delete a transaction that has been signed by an owner.")]
    TransactionAlreadySigned,
    #[msg("Overflow when adding.")]
    Overflow,
    #[msg("Cannot delete a transaction the owner did not create.")]
    UnableToDelete,
    #[msg("The given transaction has already been executed.")]
    AlreadyExecuted,
    #[msg("Threshold must be less than or equal to the number of owners and greater than zero.")]
    InvalidThreshold,
    #[msg("Owners must be unique.")]
    UniqueOwners,
    #[msg("Executor is not a multisig owner.")]
    InvalidExecutor,
    #[msg("Failed to close transaction account and refund rent-exemption SOL.")]
    AccountCloseFailed,
    #[msg("The number of instructions must be greater than zero.")]
    MissingInstructions,
}
