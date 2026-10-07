// The box-drawing renderer never lays out with ELK; only the SVG one does.
export default class ElkStub {
  constructor() {
    throw new Error('elkjs is not bundled in-process; render SVG through renderer/svg.mjs')
  }
}
