import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Sprockets" };

/**
 * Sprockets page — describes the range of sprockets stocked and ordering details.
 * @returns {JSX.Element}
 */
export default function Sprockets() {
  return (
    <main className="x-main">
      <div className="container">
        <header className="entry-header">
          <h1>Sprockets</h1>
        </header>
        <div className="entry-content">
          <p>
            There are a huge number of sprockets manufactured and so therefore
            we cannot list them all here.
          </p>
          <p>
            We can supply you (in most cases) with sprockets to increase your
            acceleration, e.g. less teeth on the gearbox sprocket, or to give
            you faster top end, e.g. less teeth on the rear sprocket. These are
            all individual tastes and we can discuss them either in person or on
            the telephone.
          </p>
          <p>
            We keep a wide variety of sprockets in stock. The most popular are
            steel as they are harder wearing and less expensive than the
            aluminium ones. Should we for some reason not have your particular
            sprocket in stock, it can normally be obtained and delivered to you
            within a very few days.
          </p>
          <p>
            For availability, prices and advice please{" "}
            <Link href="/contact-us">contact us</Link>; we will always endeavour to
            give you the best prices we can.
          </p>
        </div>
      </div>
    </main>
  );
}
