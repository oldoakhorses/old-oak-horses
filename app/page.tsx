"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";
import splashImages from "./splash-images.json";

const SPLASH_IMAGES = splashImages.length > 0 ? splashImages : ["/splash-1.jpg"];

export default function SplashPage() {
  const router = useRouter();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (SPLASH_IMAGES.length <= 1) return;
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % SPLASH_IMAGES.length);
    }, 5500);
    return () => clearInterval(interval);
  }, []);

  const goTo = (index: number) => setCurrent(index);

  return (
    <main className={styles.splash}>
      <div className={styles.splashViewport}>
        <div
          className={styles.splashTrack}
          style={{
            width: `${SPLASH_IMAGES.length * 100}%`,
            transform: `translateX(-${current * (100 / SPLASH_IMAGES.length)}%)`,
          }}
        >
          {SPLASH_IMAGES.map((src, index) => (
            <div key={`${src}-${index}`} className={styles.splashSlide} style={{ width: `${100 / SPLASH_IMAGES.length}%` }}>
              <Image
                src={src}
                alt=""
                fill
                priority={index === 0}
                sizes="100vw"
                className={styles.splashImage}
              />
            </div>
          ))}
        </div>
      </div>

      <div className={styles.splashOverlay} />

      <div className={styles.splashContent}>
        <h1 className={styles.splashTitle}>old oak horses</h1>
        <button type="button" className={styles.splashEnter} onClick={() => router.push("/login")}>
          enter
        </button>
      </div>

      {SPLASH_IMAGES.length > 1 ? (
        <div className={styles.splashDots}>
          {SPLASH_IMAGES.map((_, index) => {
            const isActive = index === current;
            return (
              <button
                key={`dot-${index}`}
                type="button"
                aria-label={`Go to splash image ${index + 1}`}
                className={`${styles.splashDot} ${isActive ? styles.splashDotActive : styles.splashDotInactive}`}
                onClick={() => goTo(index)}
              />
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
