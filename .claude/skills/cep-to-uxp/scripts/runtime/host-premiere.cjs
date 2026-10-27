// Documented Premiere Pro UXP calls for a retarget. Confirm these against the
// current premierepro types before shipping. Do not add methods that are not here.
// createSequence(name) is the one-argument form from Adobe's 25.6 sample.
// createSequenceWithPresetPath is 26.3 and needs a .sqpreset path, so it is not called.
// Unreadable JSX stays an explicit throw in host-handlers.js.

async function activeProject() {
  const { Project } = require("premierepro");
  const project = await Project.getActiveProject();
  if (!project) throw new Error("Premiere has no active project.");
  return project;
}

async function getActiveProject() {
  return activeProject();
}

async function getActiveSequence() {
  const project = await activeProject();
  return project.getActiveSequence();
}

async function getSequences() {
  const project = await activeProject();
  return project.getSequences();
}

async function getRootItem() {
  const project = await activeProject();
  return project.getRootItem();
}

async function describeSequence(sequence) {
  const rect = typeof sequence.getVideoFrameRect === "function" ? await sequence.getVideoFrameRect() : null;
  return {
    name: sequence.name || "",
    id: sequence.guid && typeof sequence.guid.toString === "function" ? sequence.guid.toString() : "",
    width: rect && rect.width,
    height: rect && rect.height
  };
}

async function createSequence(name, size) {
  const project = await activeProject();
  const sequences = (await project.getSequences()) || [];
  for (const sequence of sequences) {
    if (sequence && sequence.name === name) {
      if (typeof project.openSequence === "function") await project.openSequence(sequence);
      if (typeof project.setActiveSequence === "function") await project.setActiveSequence(sequence);
      return { created: false, ...(await describeSequence(sequence)) };
    }
  }
  const sequence = await project.createSequence(String(name || ""));
  const width = size && size.width;
  const height = size && size.height;
  if (width && height) await setSequenceFrameSize(sequence, width, height);
  if (typeof project.openSequence === "function") await project.openSequence(sequence);
  if (typeof project.setActiveSequence === "function") await project.setActiveSequence(sequence);
  return { created: true, ...(await describeSequence(sequence)) };
}

async function openSequence(sequence) {
  const project = await activeProject();
  return project.openSequence(sequence);
}

async function setActiveSequence(sequence) {
  const project = await activeProject();
  return project.setActiveSequence(sequence);
}

async function setSequenceFrameSize(sequence, width, height) {
  const project = await activeProject();
  const { RectF } = require("premierepro");
  const settings = await sequence.getSettings();
  const rect = new RectF();
  rect.width = width;
  rect.height = height;
  settings.setVideoFrameRect(rect);
  const action = settings.createSetSettingsAction();
  await project.lockedAccess(() => {
    project.executeTransaction((compound) => {
      compound.addAction(action);
    });
  });
  return describeSequence(sequence);
}

async function videoTrackItems(sequence, trackIndex) {
  const track = await sequence.getVideoTrack(trackIndex);
  if (!track || typeof track.getTrackItems !== "function") {
    throw new Error("This Premiere build has no getVideoTrack().getTrackItems(). Do not invent a replacement.");
  }
  return track.getTrackItems();
}

module.exports = {
  getActiveProject,
  getActiveSequence,
  getSequences,
  getRootItem,
  createSequence,
  openSequence,
  setActiveSequence,
  setSequenceFrameSize,
  videoTrackItems
};
