import { z } from "zod";
import { SCREENS } from "../utils/access";

export const setAccessSchema = z.object({
  screens: z.array(z.enum(SCREENS)),
});
