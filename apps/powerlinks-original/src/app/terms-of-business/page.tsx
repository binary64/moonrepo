import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Business" };

/**
 * Terms of Business page — product liability, general conditions, warranty and pricing terms.
 * @returns {JSX.Element}
 */
export default function TermsOfBusiness() {
  return (
    <main className="x-main">
      <div className="container">
        <header className="entry-header">
          <h1>Terms of Business</h1>
        </header>
        <div className="entry-content">
          <h3>Product Liability</h3>
          <p>
            All products sold by &apos;Powerlinks&apos; are covered by product
            liability insurance provided that they are fitted in accordance with
            the manufacturers&apos; instructions.
          </p>
          <p>
            No claim will be accepted where unsuitable parts have been fitted,
            for example where a standard quality chain is fitted to a 1000cc
            machine.
          </p>
          <h3>General Conditions</h3>
          <p>
            All goods and services shall remain the property of
            &apos;Powerlinks&apos; until paid in full.
          </p>
          <h3>Product Information</h3>
          <p>
            Where manufacturers names and part numbers have been used they are
            for reference purposes only, and do not indicate source of
            manufacture or any connection in the course of trade with the
            manufacturer named. In accordance with the Consumer Protection Act
            1987, every effort has been made to ensure accuracy and
            compatibility, but we believe there is a responsibility between
            seller and purchaser to be satisfied that the product is wholly
            appropriate for the intended use.
          </p>
          <h3>Prices and VAT</h3>
          <p>
            Orders are accepted on the basis that prices are subject to
            alteration without notice and goods will be invoiced at the price
            ruling at time of sale, VAT at the present rate is included on all
            items except for 0% rated items, thus all prices shown are inclusive
            of VAT.
          </p>
          <h3>Warranty Returns</h3>
          <p>
            Goods returned which have been correctly supplied may be subject to
            20% handling charge. We reserve the right to refuse for credit any
            goods specially ordered or manufactured, used or incorrectly fitted.
            We only issue credit notes, not cash refunds.
          </p>
        </div>
      </div>
    </main>
  );
}
