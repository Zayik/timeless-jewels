// TinyMT32 PRNG - ported from random/main.go
// CRITICAL: All uint32 arithmetic uses >>> 0 to force 32-bit unsigned wrapping.

const InitialStateConstant0 = 0x40336050;
const InitialStateConstant1 = 0xcfa3723c;
const InitialStateConstant2 = 0x3cac5f6f;
const InitialStateConstant3 = 0x3793fdff;

const TinyMT32Alpha = 0x19660d;
const TinyMT32Bravo = 0x5d588b65;
const TinyMT32Mask = 0x7fffffff;
const TinyMT32SH0 = 1;
const TinyMT32SH1 = 10;

function manipulateAlpha(v: number): number {
  return Math.imul((v ^ (v >>> 27)) >>> 0, TinyMT32Alpha) >>> 0;
}

function manipulateBravo(v: number): number {
  return Math.imul((v ^ (v >>> 27)) >>> 0, TinyMT32Bravo) >>> 0;
}

export class NumberGenerator {
  state: [number, number, number, number] = [0, 0, 0, 0];

  Reset(passiveSkillGraphID: number, seed: number): void {
    this.state[0] = InitialStateConstant0;
    this.state[1] = InitialStateConstant1;
    this.state[2] = InitialStateConstant2;
    this.state[3] = InitialStateConstant3;

    this.Initialize([passiveSkillGraphID >>> 0, seed >>> 0]);
  }

  Initialize(seeds: number[]): void {
    let index = 1;

    for (const seed of seeds) {
      const s0 = this.state[index % 4];
      const s1 = this.state[(index + 1) % 4];
      const sPrev = this.state[(index + 4 - 1) % 4];

      let roundState = manipulateAlpha((s0 ^ s1 ^ sPrev) >>> 0);

      this.state[(index + 1) % 4] = (this.state[(index + 1) % 4] + roundState) >>> 0;

      roundState = (roundState + (seed >>> 0) + index) >>> 0;

      this.state[(index + 1 + 1) % 4] = (this.state[(index + 1 + 1) % 4] + roundState) >>> 0;
      this.state[index % 4] = roundState;

      index = (index + 1) % 4;
    }

    for (let loop = 0; loop < 5; loop++) {
      const s0 = this.state[index % 4];
      const s1 = this.state[(index + 1) % 4];
      const sPrev = this.state[(index + 4 - 1) % 4];

      let roundState = manipulateAlpha((s0 ^ s1 ^ sPrev) >>> 0);

      this.state[(index + 1) % 4] = (this.state[(index + 1) % 4] + roundState) >>> 0;

      roundState = (roundState + index) >>> 0;

      this.state[(index + 1 + 1) % 4] = (this.state[(index + 1 + 1) % 4] + roundState) >>> 0;
      this.state[index % 4] = roundState;

      index = (index + 1) % 4;
    }

    for (let loop = 0; loop < 4; loop++) {
      const s0 = this.state[index % 4];
      const s1 = this.state[(index + 1) % 4];
      const sPrev = this.state[(index + 4 - 1) % 4];

      let roundState = manipulateBravo((s0 + s1 + sPrev) >>> 0);

      this.state[(index + 1) % 4] = (this.state[(index + 1) % 4] ^ roundState) >>> 0;

      roundState = (roundState - index) >>> 0;

      this.state[(index + 1 + 1) % 4] = (this.state[(index + 1 + 1) % 4] ^ roundState) >>> 0;
      this.state[index % 4] = roundState;

      index = (index + 1) % 4;
    }

    for (let i = 0; i < 8; i++) {
      this.GenerateNextState();
    }
  }

  GenerateNextState(): void {
    const a = this.state[3];
    let b = ((this.state[0] & TinyMT32Mask) ^ this.state[1] ^ this.state[2]) >>> 0;

    const aShifted = (a ^ (a << TinyMT32SH0)) >>> 0;
    b = (b ^ (b >>> TinyMT32SH0) ^ aShifted) >>> 0;

    this.state[0] = this.state[1];
    this.state[1] = this.state[2];
    this.state[2] = (aShifted ^ (b << TinyMT32SH1)) >>> 0;
    this.state[3] = b;

    // -(b & 1) in uint32: if b is odd, this is 0xFFFFFFFF; if even, 0
    const mask = (b & 1) !== 0 ? 0xffffffff : 0;
    this.state[1] = (this.state[1] ^ (mask & 0x8f7011ee)) >>> 0;
    this.state[2] = (this.state[2] ^ (mask & 0xfc78ff1f)) >>> 0;
  }

  Temper(): number {
    const b = (this.state[0] + (this.state[2] >>> 8)) >>> 0;
    const a = (this.state[3] ^ b) >>> 0;

    if ((b & 1) !== 0) {
      return (a ^ 0x3793fdff) >>> 0;
    }
    return a;
  }

  GenerateUInt(): number {
    this.GenerateNextState();
    return this.Temper();
  }

  GenerateSingle(exclusiveMaximumValue: number): number {
    return (this.GenerateUInt() % exclusiveMaximumValue) >>> 0;
  }

  GenerateSigned(minValue: number, maxValue: number): number {
    // Cast signed int32 range to uint32 math via the Go Generate logic,
    // then reinterpret result as signed int32.
    const result = this.Generate(minValue >>> 0, maxValue >>> 0);
    return result | 0; // reinterpret as signed int32
  }

  Generate(minValue: number, maxValue: number): number {
    // Go: a = minValue + 0x80000000; b = maxValue + 0x80000000
    const a = (minValue + 0x80000000) >>> 0;
    const b = (maxValue + 0x80000000) >>> 0;

    const roll = this.GenerateSingle((b - a + 1) >>> 0);

    return (roll + a + 0x80000000) >>> 0;
  }
}
