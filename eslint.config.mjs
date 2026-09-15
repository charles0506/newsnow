import { ourongxing } from "@ourongxing/eslint-config"

export default ourongxing({
  type: "app",
  react: true,
  ignores: ["**/routeTree.gen.ts", "userscripts/**"],
})
