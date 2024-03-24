interface Coin {
  name: string;
  ticker: string;
}

export function Coins({ coins }: { coins: Coin[] }) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 overflow-scroll py-4 -mt-2">
      {coins.map((coin, index) => (
        <div
          key={index}
          className="flex flex-col p-4 bg-zinc-900 rounded-md max-w-96 flex-shrink-0"
        >
          <div className="text-zinc-400 text-sm">
            Test
          </div>
          <div className="text-base font-bold text-zinc-200">
            {coin.name}
          </div>
          <div className="text-zinc-500">
            {coin.ticker}
          </div>
        </div>
      ))}
    </div>
  );
}
