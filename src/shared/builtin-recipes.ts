/**
 * Starter recipes from Fuji X Weekly (fujixweekly.com, by Ritchie Roesch),
 * X-Trans IV versions that work on the X100V. Stored as FXW's own text and run
 * through the paste parser, so they double as parser fixtures.
 */

import { parseRecipeText } from './parse-recipe.ts'
import type { Recipe } from './recipe.ts'

interface Source {
  id: string
  name: string
  url: string
  notes?: string
  text: string
}

const SOURCES: Source[] = [
  {
    id: 'fxw-kodachrome-64',
    name: 'Kodachrome 64',
    url: 'https://fujixweekly.com/2020/05/27/my-fujifilm-x100v-kodachrome-64-film-simulation-recipe/',
    notes: 'Exposure: 0 to +2/3 typically.',
    text: `Film Simulation: Classic Chrome
Dynamic Range: DR200
Highlight: 0
Shadow: 0
Color: +2
Noise Reduction: -4
Sharpening: +1
Clarity: +3
Grain Effect: Weak, Small
Color Chrome Effect: Strong
Color Chrome Effect Blue: Weak
White Balance: Daylight, +2 Red & -5 Blue`,
  },
  {
    id: 'fxw-kodachrome-ii',
    name: 'Kodachrome II',
    url: 'https://fujixweekly.com/2021/04/05/two-fujifilm-x-trans-iv-film-simulation-recipes-kodachrome-ii/',
    notes: 'Thomas Schwab version. Exposure: +1/3 to +2/3 typically.',
    text: `Film Simulation: Classic Chrome
Dynamic Range: DR200
Highlight: +1
Shadow: +2
Color: +1
Noise Reduction: -4
Sharpening: +1
Clarity: -2
Grain Effect: Weak, Small
Color Chrome Effect: Strong
Color Chrome Effect Blue: Weak
White Balance: Auto, +3 Red & -4 Blue`,
  },
  {
    id: 'fxw-pacific-blues',
    name: 'Pacific Blues',
    url: 'https://fujixweekly.com/2022/08/04/fujifilm-x-e4-x-trans-iv-film-simulation-recipe-pacific-blues/',
    notes: 'Exposure: +2/3 to +1 typically.',
    text: `Film Simulation: Classic Negative
Dynamic Range: DR400
Highlight: -2
Shadow: +3
Color: +4
Noise Reduction: -4
Sharpness: -2
Clarity: -3
Grain Effect: Strong, Large
Color Chrome Effect: Strong
Color Chrome Effect Blue: Strong
White Balance: 5800K, +1 Red & -3 Blue`,
  },
  {
    id: 'fxw-retro-gold',
    name: 'Retro Gold',
    url: 'https://fujixweekly.com/2021/11/22/fujifilm-x-trans-iv-film-simulation-recipe-retro-gold/',
    notes: 'Exposure: 0 to −2/3 typically.',
    text: `Film Simulation: Classic Chrome
Dynamic Range: DR400
Highlight: +4
Shadow: +2
Color: +4
Noise Reduction: -4
Sharpening: 0
Clarity: -2
Grain Effect: Weak, Small
Color Chrome Effect: Strong
Color Chrome Effect Blue: Strong
White Balance: Fluorescent 3, +4 Red & -6 Blue`,
  },
  {
    id: 'fxw-portra-400-v2',
    name: 'Kodak Portra 400 v2',
    url: 'https://fujixweekly.com/2020/12/30/fujifilm-x100v-film-simulation-recipe-kodak-portra-400-v2/',
    notes: 'Exposure: +1/3 to +1 typically.',
    text: `Film Simulation: Classic Chrome
Dynamic Range: DR400
Highlight: 0
Shadow: -2
Color: +2
Noise Reduction: -4
Sharpening: -2
Clarity: -2
Grain Effect: Strong, Small
Color Chrome Effect: Strong
Color Chrome Effect Blue: Weak
White Balance: 5200K, +1 Red & -6 Blue`,
  },
  {
    id: 'fxw-reggies-portra',
    name: "Reggie's Portra",
    url: 'https://fujixweekly.com/2022/06/11/fujifilm-x-trans-iv-film-simulation-recipe-reggies-portra/',
    text: `Film Simulation: Classic Chrome
Dynamic Range: DR-Auto
Highlight: -1
Shadow: -1
Color: +2
Noise Reduction: -4
Sharpening: -2
Clarity: 0
Grain Effect: Weak, Small
Color Chrome Effect: Strong
Color Chrome Effect Blue: Weak
White Balance: Auto, +2 Red & -4 Blue`,
  },
  {
    id: 'fxw-superia-100',
    name: 'Fujicolor Superia 100',
    url: 'https://fujixweekly.com/2020/06/09/fujifilm-x100v-film-simulation-recipe-fujicolor-superia-100/',
    notes: 'Exposure: +1/3 to +2/3 typically.',
    text: `Film Simulation: Classic Negative
Dynamic Range: DR-Auto
Highlight: -1
Shadow: -2
Color: +1
Noise Reduction: -4
Sharpening: -2
Clarity: -2
Grain Effect: Weak, Small
Color Chrome Effect: Strong
Color Chrome Effect Blue: Weak
White Balance: Daylight, 0 Red & -1 Blue`,
  },
  {
    id: 'fxw-superia-800',
    name: 'Fujicolor Superia 800',
    url: 'https://fujixweekly.com/2020/07/27/fujifilm-x100v-film-simulation-recipe-fujicolor-superia-800/',
    notes: 'Exposure: +1/3 to +2/3 typically.',
    text: `Film Simulation: Classic Negative
Dynamic Range: DR400
Highlight: -1
Shadow: +1
Color: -1
Noise Reduction: -4
Sharpening: -1
Clarity: -4
Grain Effect: Strong, Large
Color Chrome Effect: Strong
Color Chrome Effect Blue: Weak
White Balance: Daylight, -1 Red & -3 Blue`,
  },
  {
    id: 'fxw-kodak-gold-v2',
    name: 'Kodak Gold v2',
    url: 'https://fujixweekly.com/2022/01/18/fujifilm-x-trans-iv-film-simulation-recipe-kodak-gold-v2/',
    notes: 'Exposure: 0 to +2/3 typically.',
    text: `Film Simulation: Classic Chrome
Dynamic Range: DR200
Highlight: 0
Shadow: -1
Color: -1
Noise Reduction: -4
Sharpness: -1
Clarity: -2
Grain Effect: Strong, Large
Color Chrome Effect: Weak
Color Chrome Effect Blue: Off
White Balance: 5800K, +2 Red & +4 Blue`,
  },
  {
    id: 'fxw-kodachrome-1',
    name: 'Kodachrome 1',
    url: 'https://fujixweekly.com/2020/09/14/fujifilm-x100v-film-simulation-recipe-kodachrome-1/',
    notes: 'Updated Vintage Kodachrome. Exposure: −1/3 to −1 typically.',
    text: `Film Simulation: Classic Chrome
Dynamic Range: DR400
Highlight: +4
Shadow: -2
Color: +4
Noise Reduction: -4
Sharpening: -2
Clarity: +1
Grain Effect: Strong, Small
Color Chrome Effect: Strong
Color Chrome Effect Blue: Weak
White Balance: Auto, +2 Red & -4 Blue`,
  },
  {
    id: 'fxw-tri-x-400',
    name: 'Kodak Tri-X 400',
    url: 'https://fujixweekly.com/2020/06/18/fujifilm-x100v-film-simulation-recipe-kodak-tri-x-400/',
    notes: 'By Anders Lindborg. FXW allows Acros, +Ye, +R or +G; this uses +R. Exposure: +1/3 to +1 typically.',
    text: `Film Simulation: Acros + R
Dynamic Range: DR200
Highlight: 0
Shadow: +3
Noise Reduction: -4
Sharpening: +1
Clarity: +4
Grain Effect: Strong, Large
Color Chrome Effect: Strong
Color Chrome Effect Blue: Off
White Balance: Daylight, +9 Red & -9 Blue`,
  },
]

export const FXW_RECIPES: Recipe[] = SOURCES.map(s => ({
  id: s.id,
  name: s.name,
  notes: s.notes,
  source: s.url,
  builtIn: true,
  values: parseRecipeText(s.text).values,
}))

/** For tests: any line of a built-in recipe the parser didn't understand. */
export function unparsedBuiltinLines(): string[] {
  return SOURCES.flatMap(s => parseRecipeText(s.text).unrecognized.map(l => `${s.name}: ${l}`))
}
