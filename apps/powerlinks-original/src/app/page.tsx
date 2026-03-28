import Image from "next/image";

export default function Home() {
  return (
    <main className="x-main">
      <div className="container">
        <header className="entry-header">
          <h1>Motorcycle Parts and Servicing</h1>
        </header>
        <div className="entry-content">
          <p>
            <Image
              src="/images/powerlinks-front.jpg"
              alt="Powerlinks Shop Front"
              width={287}
              height={300}
              className="alignright"
              style={{ width: 287, height: "auto" }}
            />
            Come to Powerlinks to source parts and spares for most makes of
            motobike at our unit in Ringwood in Hampshire. If the part you need
            is not in stock we&apos;ll do our best to obtain it for you as
            quickly as possible at a competitive price. If you&apos;re unsure of
            the best part for your bike we&apos;ll advise you according to your
            requirements – our advice is always free! Parts and spares can be
            purchased at our unit on the Hightown Industrial Estate.
          </p>
          <p>
            As well as stocking a wide range of parts we can service and MOT
            your Triumph or Japanese brand motorcycles including Honda, Suzuki,
            Kawasaki or Yamaha.
          </p>
          <h2>Call us now on 01425 472100.</h2>
        </div>
      </div>
    </main>
  );
}
