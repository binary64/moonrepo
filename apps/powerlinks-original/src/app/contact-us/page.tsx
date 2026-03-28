import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contact Us" };

/**
 * Contact Us page — address, telephone/fax, and email for Powerlinks.
 * @returns {JSX.Element}
 */
export default function ContactUs() {
  return (
    <main className="x-main">
      <div className="container">
        <header className="entry-header">
          <h1>Contact Us</h1>
        </header>
        <div className="entry-content">
          <div className="contact-grid">
            <div className="contact-card">
              <h3>By post or to visit us:</h3>
              <p>
                Powerlinks
                <br />
                Unit 10
                <br />
                Hightown Industrial Estate
                <br />
                Crow Arch Lane
                <br />
                Ringwood
                <br />
                Hampshire
                <br />
                BH24 1ND
              </p>
            </div>
            <div className="contact-card">
              <h3>Telephone/Fax</h3>
              <p>
                <strong>T:</strong> <a href="tel:01425472100">01425 472100</a>
                <br />
                <strong>F:</strong>{" "}
                <a href="tel:+441425472123">01425 472123</a>
              </p>
            </div>
            <div className="contact-card">
              <h3>Email</h3>
              <p>
                <a href="mailto:info@powerlinks.co.uk">info@powerlinks.co.uk</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
