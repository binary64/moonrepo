import type { Metadata } from "next";

export const metadata: Metadata = { title: "Servicing and MOTs" };

export default function ServicingAndMots() {
  return (
    <main className="x-main">
      <div className="container">
        <header className="entry-header">
          <h1>Servicing and MOTs</h1>
        </header>
        <div className="entry-content">
          <p>
            As well as being providers of spares at our unit, we service and MOT
            bikes.
          </p>
          <p>
            We service and MOT most Japanese bikes as well as Triumphs. We are
            now pleased to offer a Hyperpro service centre to upgrade your
            standard suspension.
          </p>
          <h3>Lazertrack Setting</h3>
          <p>
            We can also offer the Lazertrack Setting Unit to make sure your bike
            goes in the direction it&apos;s meant to!
          </p>
          <p>
            Lazertrack is a new British product designed to take the guesswork
            out of motorcycle wheel alignment. Using lasers to check the
            relationship of front and rear wheels to within fractions of a
            degree and allowing the operator to make accurate adjustments to
            correct an out-of-line condition. Misalignment due to frame damage
            can be quickly detected.
          </p>
          <h3>Restoration Service</h3>
          <p>
            We specialise in seasonal restorations of Yamaha RD250/350 LCs.
            Please phone to make an appointment.
          </p>
          <p>
            Advice is freely given if you are uncertain on a product or spare
            part.
          </p>
        </div>
      </div>
    </main>
  );
}
