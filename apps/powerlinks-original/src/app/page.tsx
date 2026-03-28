import Image from "next/image";

export default function Home() {
  return (
    <section className="hero">
      <div className="container">
        <h1>Motorcycle Parts and Servicing</h1>
        <p>
          Come to Powerlinks to source parts and spares for most makes of
          motorbike at our unit in Ringwood in Hampshire. If the part you need
          is not in stock we&apos;ll do our best to obtain it for you as quickly
          as possible at a competitive price.
        </p>
        <p>
          If you&apos;re unsure of the best part for your bike we&apos;ll advise
          you according to your requirements – our advice is always free! Parts
          and spares can be purchased at our unit on the Hightown Industrial
          Estate.
        </p>
        <p>
          As well as stocking a wide range of parts we can service and MOT your
          Triumph or Japanese brand motorcycles including Honda, Suzuki,
          Kawasaki or Yamaha.
        </p>
        <div className="phone">Call us now on 01425 472100</div>
        <Image
          src="/images/powerlinks-front.jpg"
          alt="Powerlinks motorcycle shop front in Ringwood"
          width={600}
          height={628}
          className="hero-image"
          priority
        />
      </div>
    </section>
  );
}
