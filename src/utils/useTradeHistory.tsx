import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useFills } from './markets';
import { useMarginAccount } from './marginAccounts';
import { isDefined } from './utils';

const byTimestamp = (a, b) => {
  return new Date(b.loadTimestamp).getTime() - new Date(a.loadTimestamp).getTime();
};

const formatTradeHistory = (newTradeHistory) => {
  return newTradeHistory
    .flat()
    .map((trade, i) => {
      return {
        ...trade,
        marketName: trade.marketName
          ? trade.marketName
          : `${trade.baseCurrency}/${trade.quoteCurrency}`,
        key: `${trade.orderId}${trade.side}${trade.uuid}`,
        liquidity: trade.maker || trade?.eventFlags?.maker ? 'Maker' : 'Taker',
      };
    })
    .sort(byTimestamp);
};

export const usePrevious = (value) => {
  const ref = useRef();
  // Store current value in ref
  useEffect(() => {
    ref.current = value;
  }, [value]); // Only re-run if value changes
  // Return previous value (happens before update in useEffect above)
  return ref.current;
};

export const useTradeHistory = () => {
  const eventQueueFills = useFills(1000);
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [loadingHistory, setloadingHistory] = useState(false);
  const [allTrades, setAllTrades] = useState<any[]>([]);
  const { marginAccount } = useMarginAccount();

  const fetchTradeHistory = useCallback(async () => {
    if (!marginAccount || marginAccount.openOrdersAccounts.length === 0) return null;
    setloadingHistory(true);
    const openOrdersAccounts = marginAccount.openOrdersAccounts.filter(isDefined);
    const publicKeys = openOrdersAccounts.map((act) => act.publicKey.toString());
    const results = await Promise.all(
      publicKeys.map(async (pk) => {
        const response = await fetch(
          `https://stark-fjord-45757.herokuapp.com/trades/open_orders/${pk.toString()}`,
        );

        const parsedResponse = await response.json();
        return parsedResponse?.data ? parsedResponse.data : [];
      }),
    );

    setTradeHistory(formatTradeHistory(results));
    setAllTrades(formatTradeHistory(results));
    setloadingHistory(false);
  }, [marginAccount, eventQueueFills]);

  useEffect(() => {
    if (marginAccount && tradeHistory.length === 0) {
      fetchTradeHistory();
    }
  }, [marginAccount]);

  useEffect(() => {
    if (eventQueueFills && eventQueueFills.length > 0) {
      const newFills = eventQueueFills.filter(
        (fill) => !tradeHistory.find((t) => t.orderId === fill.orderId.toString()),
      );
      const newTradeHistory = [...newFills, ...tradeHistory];
      if (newFills.length > 0 && newTradeHistory.length !== allTrades.length) {
        const formattedTradeHistory = formatTradeHistory(newTradeHistory);

        setAllTrades(formattedTradeHistory);
      }
    }
  }, [tradeHistory, eventQueueFills]);

  return { tradeHistory: allTrades, loadingHistory, fetchTradeHistory };
};
