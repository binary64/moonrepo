import type { Metadata } from "next";

export const metadata: Metadata = { title: "Batteries" };

export default function Batteries() {
  return (
    <main className="x-main">
      <div className="container">
        <header className="entry-header">
          <h1>Batteries</h1>
        </header>
        <div className="entry-content">
          <p>
            Most types of lead/acid batteries are held in stock (dry charged 6v
            and 12v). Others can be obtained from manufacturers GS, Yuasa and
            Exide. All YTX and CTX gel sealed batteries in stock.
          </p>
          <p>
            All personal callers can collect batteries &quot;wet&quot; at no
            extra charge, although most car accessory shops and garages will
            fill your battery for a small charge.
          </p>
          <p>
            For the correct application for your bike please give us a call on{" "}
            <strong>01425 472100</strong>.
          </p>
        </div>
      </div>
    </main>
  );
}
