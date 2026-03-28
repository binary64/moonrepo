import type { Metadata } from "next";

export const metadata: Metadata = { title: "Parts and Spares" };

export default function PartsAndSpares() {
  return (
    <main className="main">
      <div className="container">
        <div className="content-box">
          <h2>Parts and Spares</h2>
          <p>
            Many spare parts are available for your bike. If we do not have
            stock we can usually source anything you require very quickly.
            Please give us a call with your requirements, making sure you have
            all the relevant information about your bike with you. Call us now
            on <strong>01425 472100</strong>. We keep stocks of:
          </p>
          <ul>
            <li>
              <strong>Oils</strong> by Maxima and Motorex
            </li>
            <li>
              <strong>Oil Filters</strong> by Vesrah
            </li>
            <li>
              <strong>Brake Pads</strong> by Vesrah and EBC
            </li>
            <li>
              <strong>Handlebars</strong> – World famous &quot;Renthal&quot;
              bars are available in polished or anodised colours. Manufactured
              from aircraft specification, heat treated alloy they are of superb
              quality. A range of colours are available. Bar end weights are
              also available in various colours.
            </li>
            <li>
              <strong>Grips</strong> – A selection of handlebar grips are
              available from &quot;Progrip&quot; and &quot;Renthal&quot;. Many
              colours, patterns and compounds to choose from.
            </li>
            <li>
              We are distributors for <strong>Wurth</strong> products,
              lubricants and cleaners
            </li>
            <li>
              <strong>Spark Plugs</strong>
            </li>
            <li>
              <strong>Clutches</strong>
            </li>
            <li>
              <strong>Pro Bolt Nuts and Bolts</strong>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
