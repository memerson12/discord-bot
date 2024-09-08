/**
 * This calculates the Rank Biased Overlap (RBO) for two sorted lists.
 *
 * Based on "A Similarity Measure for Indefinite Rankings" William Webber, Alistair Moffat,
 * and Justin Zobel (Nov 2010).
 *
 * For more information, read
 *  http://www.williamwebber.com/research/papers/wmz10_tois.pdf
 *
 * Based on the reference by Damian Gryski in Golang available from
 *  https://github.com/dgryski
 *
 * @license Licensed under the MIT license.
 *
 * @author Dag Holmberg
 * https://github.com/holmberd
 */

class RBO {
  p: number;
  rbo: number;
  depth: number;
  overlap: number;
  shortDepth: number;
  seen: Map<any, boolean>;
  wgt: number;
  shortOverlap: number;

  constructor(p: number) {
    this.p = p;
    this.rbo = 0;
    this.depth = 0;
    this.overlap = 0;
    this.shortDepth = -1;
    this.seen = new Map();
    this.wgt = (1 - p) / p;
    this.shortOverlap = -1;
  }

  /**
   * Calculates the weight of first d rankings with parameter p
   * @static
   * @param {number} p - degree (0..1) of top-weightedness of the RBO metric
   * @param {number} d - ranking
   */
  static calcWeight(p: number, d: number): number {
    let summa = 0;
    for (let i = 1; i < d; i++) {
      summa += Math.pow(p, i) / i;
    }
    return 1 - Math.pow(p, d - 1) + ((1 - p) / p) * d * (Math.log(1 / (1 - p)) - summa);
  }

  /**
   * Calculates similarity RBO
   * @param {Array<any>} s - sorted ranked list
   * @param {Array<any>} t - sorted ranked list
   * @return {number} - extrapolated calculation
   */
  calculate(s: any[], t: any[]): number {
    if (t.length < s.length) {
      const _t = s;
      s = t;
      t = _t;
    }
    for (let i = 0, l = s.length; i < l; i++) {
      this.update(s[i], t[i]);
    }
    this.endShort();
    if (t.length > s.length) {
      for (let n = s.length, le = t.length; n < le; n++) {
        this.updateUneven(t[n]);
      }
    }
    return this.calcExtrapolated();
  }

  /**
   * Calculates the estimate beyond the original observation range
   * @return {number} - similarity RBO scores achieved
   */
  calcExtrapolated(): number {
    const pl = Math.pow(this.p, this.depth);
    if (this.shortDepth == -1) {
      this.endShort();
    }
    return (
      this.rbo +
      ((this.overlap - this.shortOverlap) / this.depth + this.shortOverlap / this.shortDepth) * pl
    );
  }

  /**
   * Adds elements from the two lists to our state calculation
   * @param {any} e1
   * @param {any} e2
   */
  update(e1: any, e2: any): void | boolean {
    if (this.shortDepth !== -1) {
      console.log('RBO: update() called after endShort()');
      return false;
    }
    if (e1 === e2) {
      this.overlap++;
    } else {
      if (this.seen.has(e1)) {
        this.seen.set(e1, false);
        this.overlap++;
      } else {
        this.seen.set(e1, true);
      }

      if (this.seen.has(e2)) {
        this.seen.set(e2, false);
        this.overlap++;
      } else {
        this.seen.set(e2, true);
      }
    }
    this.depth++;
    this.wgt *= this.p;
    this.rbo += (this.overlap / this.depth) * this.wgt;
  }

  /**
   * Indicates the end of the shorter of the two lists has been reached
   */
  endShort(): void {
    this.shortDepth = this.depth;
    this.shortOverlap = this.overlap;
  }

  /**
   * Adds elements from the longer list to the state calculation
   * @param {any} e
   */
  updateUneven(e: any): void | boolean {
    if (this.shortDepth === -1) {
      console.log('RBO: updateUneven() called without endShort()');
      return false;
    }
    if (this.seen.get(e)) {
      this.overlap++;
      this.seen.set(e, false);
    }
    this.depth++;
    this.wgt *= this.p;
    this.rbo += (this.overlap / this.depth) * this.wgt;
    this.rbo +=
      ((this.shortOverlap * (this.depth - this.shortDepth)) / (this.depth * this.shortDepth)) *
      this.wgt;
  }
}

export default RBO;
