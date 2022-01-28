// Hooks and helper functions for handling user's margin accounts are here
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
// Import function to create margin account from mango library
import { IDS, MangoGroup, MangoClient, MarginAccount } from '@blockworks-foundation/mango-client';
// Import some mango client functions
import { DEFAULT_MANGO_GROUP, initMarginAccount } from './mango';
// Connection context
import { useConnection, useConnectionConfig } from '../utils/connection';
// Wallet context
import { useWallet } from '../utils/wallet';
// Type annotations
import { PublicKey } from '@solana/web3.js';
import { FeeRates, MarginAccountContextValues, MarginAccountWithGroup } from '../utils/types';
import { nativeToUi } from '@blockworks-foundation/mango-client/lib/utils';
import { SRM_DECIMALS } from '@project-serum/serum/lib/token-instructions';
import { getFeeTier, getFeeRates } from '@project-serum/serum';
import { MangoSrmAccount } from '@blockworks-foundation/mango-client/lib/client';
import { parseTokenAccountData } from './tokens';

// Create a context to share account state across pages
const MarginAccountContext = React.createContext<null | MarginAccountContextValues>(null);

// Precision for our mango group token
export const tokenPrecision = {
  BTC: 4,
  ETH: 3,
  USDC: 2,
  USDT: 2,
  WUSDT: 2,
};

// Create the margin account provider
export function MarginAccountProvider({ children }) {
  // Get all state and functions we need for context
  const {
    marginAccount,
    marginAccounts,
    marginAccountWithGroup,
    marginAccountsWithGroups,
    mango_groups,
    mangoOptions,
    mangoGroup,
    mangoClient,
    createMarginAccount,
    setMarginAccount,
    setMarginAccounts,
    setMarginAccountWithGroup,
    setMarginAccountsWithGroups,
    maPending,
    setMAPending,
    getMarginAccount,
    getAllMarginAccountsForAllGroups,
    size,
    setSize,
    srmFeeRates,
    totalSrm,
    contributedSrm,
    mangoSrmAccounts,
    getUserSrmInfo,
  } = useMarginAccountHelper();
  // Return a context with this values set as default
  return (
    <MarginAccountContext.Provider
      value={{
        marginAccount,
        marginAccounts,
        marginAccountWithGroup,
        marginAccountsWithGroups,
        mango_groups,
        mangoOptions,
        mangoClient,
        mangoGroup,
        createMarginAccount,
        setMarginAccount,
        setMarginAccounts,
        setMarginAccountWithGroup,
        setMarginAccountsWithGroups,
        maPending,
        setMAPending,
        getMarginAccount,
        getAllMarginAccountsForAllGroups,
        size,
        setSize,
        srmFeeRates,
        totalSrm,
        contributedSrm,
        mangoSrmAccounts,
        getUserSrmInfo,
      }}
    >
      {children}
    </MarginAccountContext.Provider>
  );
}

// Put some state logic in here in DRY
const useMarginAccountHelper = () => {
  // Save all margin account for a mango group
  const [marginAccounts, setMarginAccounts] = useState<MarginAccount[] | []>([]);
  // Current margin account
  const [marginAccount, setMarginAccount] = useState<MarginAccount | null>(null);
  // User's margin account with corresponding mango group
  const [marginAccountWithGroup, setMarginAccountWithGroup] = useState<MarginAccountWithGroup | null>(null);
  // All user's margin accounts with all corresponding mango groups
  const [marginAccountsWithGroups, setMarginAccountsWithGroups] = useState<MarginAccountWithGroup[] | []>([]);
  // Get the current connection
  // The current mango group state.
  const [mangoGroup, setMangoGroup] = useState<MangoGroup | null>(null);
  // Save the current mango group identifier
  // TODO: Allow for changing
  const [mango_groups, setMango_Groups] = useState(DEFAULT_MANGO_GROUP.split('_'));
  // Let's know when any transaction is pending
  const [maPending, setMAPending] = useState<any>(() => {
    return {
      cma: false, // Is create a margin account taks pending
      sma: false, // Is set a margin account pending
    };
  });
  const connection = useConnection();
  // Now get the current wallet
  const { wallet, connected } = useWallet();
  // Get what endpoint contract is runnig from
  const { endpointInfo } = useConnectionConfig();
  // Get the mango Options (for connection type)
  const [mangoOptions, setmangoOptions] = useState<any>(IDS[endpointInfo!.name]);
  // Size of token to buy in the trade form
  const [size, setSize] = useState<{ currency: string; size: number }>({ currency: '', size: 0 });
  // Now our mango client connection
  // Now our mango client instance
  const mangoClient = new MangoClient();
  // id for our interval object
  const intervalId = useRef<NodeJS.Timeout>();
  // mango group srm fee info
  const [totalSrm, setTotalSrm] = useState(0);
  const [srmFeeRates, setSrmFeeRates] = useState<FeeRates | null>(null);
  const [mangoSrmAccounts, setMangoSrmAccounts] = useState<MangoSrmAccount[] | null>(null);
  const [contributedSrm, setContributedSrm] = useState(0);

  /**
   * @summary Create a margin account for a mango group
   */
  const createMarginAccount = async (): Promise<MarginAccount | null> => {
    if (!mangoGroup) {
      console.error('No mango group selected before creating a margin account');
      // setMAPending((prev) => {
      //   prev['cma'] = false;
      //   return prev;
      // });
      return null;
    }
    // Carry on if we have mango group
    return await initMarginAccount(
      connection,
      new PublicKey(mangoOptions.mango_program_id),
      mangoGroup,
      wallet,
    )
      .then(async (marginAccountPK) => {
        // Let's get the margin account object
        let marginAccount = await mangoClient.getMarginAccount(
          connection,
          marginAccountPK,
          mangoOptions.dex_program_id,
        );
        // Now get all margin accounts
        // Set the margin accounts PK
        setMarginAccount(marginAccount);
        getAllMarginAccountsForGroup();
        return marginAccount;
        // setMAPending(prev => { prev['cma'] = false; return prev });
      })
      .catch((err) => {
        console.error(err);
        return null;
        // setMAPending(prev => { prev['cma'] = false; return prev });
      });
  };

  /**
   * @summary get all margin accounts for a mango group
   * @kehinde - this function is not necessary. mangoClient.getMarginAccountsForOwner already filters for mangoGroup
   */
  const getAllMarginAccountsForGroup = async () => {
    // Set pending transaction
    setMAPending((prev) => {
      prev['sma'] = true;
      return prev;
    });
    if (!mangoGroup) {
      // Did the user not make a selection or maybe our effects have not ran
      console.error('No mango group while getting all margin accounts for a group');
      return [];
    }
    // Let's get the public keys for the margin accounts
    await mangoClient
      .getMarginAccountsForOwner(
        connection,
        new PublicKey(mangoOptions.mango_program_id),
        mangoGroup,
        wallet,
      )
      .then((marginAccounts) => {
        setMAPending((prev) => {
          prev['sma'] = false;
          return prev;
        });
        setMarginAccounts(marginAccounts);
        if (marginAccounts.length > 0 && !marginAccount) {
          // Get the margin account with the largest amount
          let highestMAcc: MarginAccount = marginAccounts[0];
          let lastEquity = 0;
          mangoGroup.getPrices(connection).then((prices) => {
            marginAccounts.forEach((marginAcc: MarginAccount) => {
              let equity = marginAcc.computeValue(mangoGroup, prices);
              highestMAcc = equity > lastEquity ? marginAcc : highestMAcc;
              lastEquity = equity;
            });
            setMarginAccount(highestMAcc);
          });
        }
      })
      .catch((err) => {
        console.error('Could not get margin accounts for user in effect ', err);
        setMAPending((prev) => {
          prev['sma'] = false;
          return prev;
        });
      });
  };

  const getMarginAccount = async (pubKey: PublicKey | undefined): Promise<MarginAccount | null> => {
    if (!mangoGroup || (!pubKey && !marginAccount)) {
      console.error(
        'No mango group or margin account while getting margin account detail for a group',
      );
      return marginAccount;
    }
    // Let's get the public keys for the margin accounts
    return mangoClient
      .getMarginAccount(
        connection,
        // @ts-ignore
        pubKey ? pubKey : marginAccount.publicKey,
        new PublicKey(mangoOptions.dex_program_id),
      )
      .then((account: MarginAccount | null) => {
        // Return the first account
        return account;
      })
      .catch((err) => {
        console.error(err);
        return marginAccount;
      });
  };

  // If we loose connection to wallet, clear the margin account state
  useEffect(() => {
    // Set the default mango group
    if (!mangoGroup) {
      // No mango group yet, get the default
      // Did the user make any selection ??
      // Use default mango group of ETH_BTC_USDT
      // Set up default mango group
      // Get the Mango group. For now we use our default BTC_ETH_USDT
      // TODO: Allow to select a mango group
      let MangoGroup = mangoOptions.mango_groups.BTC_ETH_USDT;
      if (!MangoGroup) return;
      let mangoGroupPk = new PublicKey(MangoGroup.mango_group_pk);
      let srmVaultPk = new PublicKey(MangoGroup.srm_vault_pk);
      mangoClient
        .getMangoGroup(connection, mangoGroupPk, srmVaultPk)
        .then((mangoGroup) => {
          // Set the mango group
          setMangoGroup(mangoGroup);
        })
        .catch((err) => {
          console.error('Could not get mango group');
        });
    }
    if (!connected) {
      // We lost connection to wallet, remove the margin accounts
      setMarginAccount(null);
      // Remove the margin accounts pk
      setMarginAccounts([]);
      return;
    }
    if (!marginAccounts || !marginAccount) {
      // setMAPending(prev => { prev['sma'] = true; return prev; });
      // No margin account for the user, get them
      getAllMarginAccountsForGroup();
    }
  }, [connected, connection, mangoGroup]);
  // This effect would create a timer to get the user's balance and interest rate for the selected margin account.
  // TODO: Find a beter impl like websocket
  useEffect(() => {
    if (!connected) {
      // CLear any timeout
      if (intervalId.current) {
        clearTimeout(intervalId.current);
      }
    }
    // Get the balance and interest every 10s
    const id = setTimeout(async () => {
      // Check if margin account exist
      if (!marginAccount || !connected) {
        return;
      }
      // Get all margin accounts again
      await getMarginAccount(undefined)
        .then((account) => {
          // If the margin account has changed by the time we are done, ignore the state update
          if (
            account &&
            account.publicKey.toString() === marginAccount.publicKey.toString() &&
            connected
          ) {
            setMarginAccount(account);
          }
        })
        .catch((err) => {
          // COuld not set margin account
          console.error(err);
        });
      let MangoGroup = mangoOptions.mango_groups.BTC_ETH_USDT;
      if (MangoGroup) {
        let mangoGroupPk = new PublicKey(MangoGroup.mango_group_pk);
        let srmVaultPk = new PublicKey(MangoGroup.srm_vault_pk);
        mangoClient
          .getMangoGroup(connection, mangoGroupPk, srmVaultPk)
          .then((mangoGroup) => {
            // Set the mango group
            setMangoGroup(mangoGroup);
          })
          .catch((err) => {
            console.error('Could not get mango group');
          });
      }
    }, 3000);
    intervalId.current = id;
    return () => {
      if (intervalId.current) {
        clearTimeout(intervalId.current);
      }
    };
  }, [marginAccount, connected]);
  // TODO: Should the mango group change, reset our margin accounts and account

  const getAllMarginAccountsForAllGroups = async () => {
    const allMarginAccountsWithGroups : MarginAccountWithGroup[] = [];
    for (let mangoGroupKey of Object.keys(mangoOptions.mango_groups)) {
      const MangoGroup = mangoOptions.mango_groups[mangoGroupKey];
      let mangoGroupPk = new PublicKey(MangoGroup.mango_group_pk);
      let srmVaultPk = new PublicKey(MangoGroup.srm_vault_pk);
      const mangoGroup = await mangoClient.getMangoGroup(connection, mangoGroupPk, srmVaultPk);
      const marginAccounts = await mangoClient
        .getMarginAccountsForOwner(
          connection,
          new PublicKey(mangoOptions.mango_program_id),
          mangoGroup,
          wallet,
        );
      if (marginAccounts) {
        mangoGroup.getPrices(connection).then((prices) => {
          marginAccounts.forEach((marginAcc: MarginAccount) => {
            const marginAccountWithGroup = {
              mangoGroup: MangoGroup,
              marginAccount: marginAcc,
              equity: marginAcc.computeValue(mangoGroup, prices)
            };
            allMarginAccountsWithGroups.push(marginAccountWithGroup);
          });
        });
      }
    }
    return allMarginAccountsWithGroups;
  }

  const getSrmFeeInfo = useCallback(async () => {
    if (!mangoGroup) return;
    const srmAccountInfo = await connection.getAccountInfo(mangoGroup.srmVault);
    if (!srmAccountInfo) return;
    const accountData = parseTokenAccountData(srmAccountInfo.data);
    const amount = nativeToUi(accountData.amount, SRM_DECIMALS);
    setTotalSrm(amount);
    const feeTier = getFeeTier(0, amount);
    const rates = getFeeRates(feeTier);
    setSrmFeeRates(rates);
  }, [mangoGroup]);

  useEffect(() => {
    getSrmFeeInfo();
  }, [getSrmFeeInfo]);

  const getUserSrmInfo = useCallback(async () => {
    if (!mangoGroup || !connected) return;

    const usersMangoSrmAccounts = await mangoClient.getMangoSrmAccountsForOwner(
      connection,
      new PublicKey(mangoOptions.mango_program_id),
      mangoGroup,
      wallet,
    );

    setMangoSrmAccounts(usersMangoSrmAccounts);

    if (usersMangoSrmAccounts.length) {
      setContributedSrm(nativeToUi(usersMangoSrmAccounts[0].amount, SRM_DECIMALS));
    }
    await getSrmFeeInfo();
  }, [connected, mangoGroup]);

  useEffect(() => {
    getUserSrmInfo();
  }, [getUserSrmInfo]);

  return {
    marginAccount,
    marginAccounts,
    marginAccountWithGroup,
    marginAccountsWithGroups,
    mangoGroup,
    mangoOptions,
    mango_groups,
    mangoClient,
    createMarginAccount,
    setMarginAccount,
    setMarginAccounts,
    setMarginAccountWithGroup,
    setMarginAccountsWithGroups,
    maPending,
    setMAPending,
    getMarginAccount,
    getAllMarginAccountsForAllGroups,
    size,
    setSize,
    srmFeeRates,
    totalSrm,
    mangoSrmAccounts,
    contributedSrm,
    getUserSrmInfo,
  };
};

// Easily pick what margin account context to use
export function useMarginAccount() {
  // Get the margin account context
  const marginAccountContext = useContext(MarginAccountContext);
  if (!marginAccountContext) {
    // Context does not exist
    throw new Error('Missing margin account context');
  }
  // Build a mapping of pubkeys to marginaccounts
  const buildPubKeytoAcountMapping = (): Map<PublicKey, MarginAccount> => {
    let mapping = new Map();
    marginAccountContext.marginAccounts.forEach((account) => {
      mapping.set(account.publicKey.toBase58(), account);
    });
    // Set a key to create a new account
    mapping.set('new', null);
    return mapping;
  };

  return {
    marginAccount: marginAccountContext.marginAccount,
    marginAccounts: marginAccountContext.marginAccounts,
    marginAccountWithGroup: marginAccountContext.marginAccountWithGroup,
    marginAccountsWithGroups: marginAccountContext.marginAccountsWithGroups,
    mango_groups: marginAccountContext.mango_groups,
    mango_options: marginAccountContext.mangoOptions,
    mangoClient: marginAccountContext.mangoClient,
    mangoGroup: marginAccountContext.mangoGroup,
    createMarginAccount: marginAccountContext.createMarginAccount,
    setMarginAccount: marginAccountContext.setMarginAccount,
    setMarginAccounts: marginAccountContext.setMarginAccounts,
    setMarginAccountWithGroup: marginAccountContext.setMarginAccountWithGroup,
    setMarginAccountsWithGroups: marginAccountContext.setMarginAccountsWithGroups,
    maPending: marginAccountContext.maPending,
    setMAPending: marginAccountContext.setMAPending,
    getMarginAccount: marginAccountContext.getMarginAccount,
    getAllMarginAccountsForAllGroups: marginAccountContext.getAllMarginAccountsForAllGroups,
    size: marginAccountContext.size,
    setSize: marginAccountContext.setSize,
    keyMappings: buildPubKeytoAcountMapping,
    srmFeeRates: marginAccountContext.srmFeeRates,
    totalSrm: marginAccountContext.totalSrm,
    mangoSrmAccounts: marginAccountContext.mangoSrmAccounts,
    contributedSrm: marginAccountContext.contributedSrm,
    getUserSrmInfo: marginAccountContext.getUserSrmInfo,
  };
}
