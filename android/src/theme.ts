// GigWork's web tokens (src/styles.css :root), carried over unchanged.
export const color = {
  navy: "#00063d", navySoft: "#202761", flame: "#fa4028", flameDown: "#dc311b",
  paper: "#f2f2f2", white: "#ffffff", line: "#e1e2e8", muted: "#626579", faint: "#85869b",
  green: "#e6ffd4", lime: "#9bff65", blue: "#ceebff", pink: "#ffe6f3", yellow: "#fffbb7", coral: "#ffe8e2", purple: "#e9dfff",
};
export type Tone = "green" | "blue" | "yellow" | "coral" | "purple" | "pink";
export const tone: Record<Tone, string> = { green: color.green, blue: color.blue, yellow: color.yellow, coral: color.coral, purple: color.purple, pink: color.pink };

export const font = {
  serif: "Feature-Regular", serifBold: "Feature-Semibold",
  sans: "ROM-Book", sansRegular: "ROM-Regular", sansMedium: "ROM-Medium", mono: "ROMMono-Book",
};
export const fontFiles = {
  "Feature-Regular": require("../assets/fonts/Feature-Regular.ttf"),
  "Feature-Semibold": require("../assets/fonts/Feature-Semibold.ttf"),
  "ROM-Book": require("../assets/fonts/ROM-Book.ttf"),
  "ROM-Regular": require("../assets/fonts/ROM-Regular.ttf"),
  "ROM-Medium": require("../assets/fonts/ROM-Medium.ttf"),
  "ROMMono-Book": require("../assets/fonts/ROMMono-Book.ttf"),
};
export const radius = { card: 22, tile: 20, button: 16, pill: 999, chip: 8 };
export const mascots = {
  owl: require("../../public/assets/mascots/gigwork-owl.png"),
  fox: require("../../public/assets/mascots/gigwork-fox-v2.png"),
  robot: require("../../public/assets/mascots/gigwork-robot.png"),
};
