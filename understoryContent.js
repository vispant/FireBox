// Understory -- pure data. No DOM/canvas code lives here on purpose: this
// file is what a content-accuracy pass reviews (is this species real, is
// this fact correct, is this line short enough), while understoryGame.js is
// what an engine pass reviews (does physics/state work) -- keeping them
// separate means neither review has to wade through the other's concerns.
//
// All content is grounded in one real habitat: a Pacific coastal temperate
// rainforest watershed (the fictional "Driftmoss Watershed"), per the
// project's success criteria ("focuses on one particular habitat, and all
// content relates to this habitat").

// ---------------------------------------------------------------------------
// Concepts: short (<=100 char) in-combat banner line + a longer Journal entry.
// ---------------------------------------------------------------------------
export const CONCEPTS = {
  biotic: {
    term: "Biotic Factors",
    short: "Biotic factors are the living parts of a habitat -- plants, animals, fungi.",
    long: "Biotic factors are every living thing that shapes an ecosystem: producers, consumers, decomposers, and everything that eats, competes with, or depends on them. The Driftmoss Watershed's biotic factors include everything from towering Sitka spruce to the fungi breaking down a fallen log.",
  },
  abiotic: {
    term: "Abiotic Factors",
    short: "Soil, water, and sunlight are abiotic factors -- non-living, but essential.",
    long: "Abiotic factors are the non-living parts of an ecosystem: sunlight, water, temperature, soil chemistry, and terrain. They don't grow or reproduce, but every biotic factor depends on them -- when an abiotic factor like water becomes scarce, it limits what can live there.",
  },
  habitat: {
    term: "Habitat",
    short: "A habitat is the specific place a species lives -- its home within the ecosystem.",
    long: "A habitat is the physical place where a species finds what it needs to survive: food, water, shelter, and space. The Driftmoss Watershed contains many habitats -- a riverbank, a mossy old-growth floor, a windswept ridge -- all part of one connected ecosystem.",
  },
  ecosystem: {
    term: "Ecosystem",
    short: "An ecosystem is every living and non-living thing in an area, interacting together.",
    long: "An ecosystem is a community of organisms interacting with each other and with their abiotic environment, exchanging energy and matter. The Driftmoss Watershed -- from alpine snowpack to tidal delta -- is one ecosystem, connected by the water and nutrients that flow through it.",
  },
  species: {
    term: "Species",
    short: "A species is a group of organisms that can interbreed -- like all Roosevelt elk.",
    long: "A species is a group of organisms with shared characteristics that can reproduce together. The watershed is home to hundreds of species, from Sitka spruce trees to banana slugs, each playing a distinct role in the ecosystem.",
  },
  population: {
    term: "Population",
    short: "A population is all the members of one species living in the same place.",
    long: "A population is every individual of a single species living in the same area at the same time -- like every Roosevelt elk herd in the River Valley. Populations grow, shrink, and compete for the same resources.",
  },
  community: {
    term: "Community",
    short: "A community is all the different populations living and interacting together.",
    long: "A community is every population of every species sharing one habitat -- the elk, cougars, spruce trees, and fungi of the Old-Growth Forest all form one community, bound together by who eats whom and who depends on whom.",
  },
  producers: {
    term: "Producers",
    short: "Producers like these ferns make their own food from sunlight -- photosynthesis.",
    long: "Producers (autotrophs) make their own food, usually by converting sunlight into energy through photosynthesis. Sitka spruce, western hemlock, and sword ferns are the watershed's producers -- the base every other organism's energy ultimately comes from.",
  },
  consumers: {
    term: "Consumers",
    short: "Consumers can't make their own food -- they get energy by eating other organisms.",
    long: "Consumers (heterotrophs) get energy by eating other organisms rather than making their own food. Every animal in the watershed, from a mouse to a cougar, is a consumer -- and each depends, directly or indirectly, on producers.",
  },
  decomposers: {
    term: "Decomposers",
    short: "Spores help decomposers break dead matter into soil nutrients -- nothing is wasted.",
    long: "Decomposers break down dead organisms and waste into simpler nutrients, returning them to the soil. Fungi growing on a fallen 'nurse log' are classic decomposers -- without them, nutrients would stay locked in dead wood forever.",
  },
  photosynthesis: {
    term: "Photosynthesis",
    short: "Photosynthesis turns sunlight, water, and CO2 into sugar -- a producer's food.",
    long: "Photosynthesis is the process producers use to convert sunlight, water, and carbon dioxide into glucose (food) and oxygen. It's the foundation of almost every food chain in the Driftmoss Watershed, and in nearly every ecosystem on Earth.",
  },
  herbivore: {
    term: "Herbivore",
    short: "Roosevelt elk are herbivores and primary consumers -- they eat producers directly.",
    long: "Herbivores eat only producers (plants). Roosevelt elk and black-tailed deer are the watershed's major herbivores, and as the first link to feed directly on producers, they're also primary consumers.",
  },
  carnivore: {
    term: "Carnivore",
    short: "Cougars are carnivores and secondary consumers, hunting elk and deer for energy.",
    long: "Carnivores eat only other animals. Cougars and gray wolves are the watershed's main carnivores -- as predators of herbivores, they're secondary consumers, and sit higher on the energy pyramid than the elk they hunt.",
  },
  omnivore: {
    term: "Omnivore",
    short: "Black bears are omnivores -- they eat salmon, berries, insects, and roots.",
    long: "Omnivores eat both producers and other consumers. Black bears are the watershed's signature omnivore: salmon in autumn, berries in summer, insects and roots whenever they can find them -- a diet flexible enough to link multiple food chains at once.",
  },
  scavenger: {
    term: "Scavenger",
    short: "Bald eagles often scavenge salmon carcasses, linking the river to the forest.",
    long: "Scavengers eat animals they didn't kill themselves, usually carrion. Bald eagles and ravens scavenge spawned-out salmon carcasses along the river, carrying ocean-derived nutrients into the surrounding forest.",
  },
  detritivore: {
    term: "Detritivore",
    short: "Banana slugs are detritivores -- they eat dead leaves and recycle the nutrients.",
    long: "Detritivores feed on dead organic matter -- fallen leaves, rotting wood, waste -- breaking it into smaller pieces that decomposers can finish processing. Banana slugs are the watershed's most iconic detritivore.",
  },
  organicMatter: {
    term: "Organic Matter",
    short: "Fallen leaves and wood are organic matter -- once living, now feeding the soil.",
    long: "Organic matter is material that came from living things -- dead leaves, fallen trees, animal waste. As decomposers and detritivores break it down, its nutrients cycle back into the soil, feeding the next generation of producers.",
  },
  foodWeb: {
    term: "Food Web",
    short: "A flood changes who can live here -- shifting the whole river food web, not one species.",
    long: "A food web is the full network of overlapping food chains in an ecosystem -- every organism connects to several others, not just one. In the Driftmoss Watershed, spruce feed insects, insects feed birds, salmon feed bears and eagles, and bears fertilize the forest -- all one interconnected web.",
  },
  foodChain: {
    term: "Food Chain",
    short: "Sunlight to fern to elk to cougar: a simple food chain moving energy upward.",
    long: "A food chain is one single path energy takes through an ecosystem: producer to primary consumer to secondary consumer, and so on. Sword fern to Roosevelt elk to cougar is one real food chain in the Driftmoss Watershed.",
  },
  primaryConsumer: {
    term: "Primary Consumer",
    short: "Elk are primary consumers: the first link to eat a producer directly.",
    long: "Primary consumers eat producers directly -- they're the second step in any food chain, right after producers themselves. Roosevelt elk, black-tailed deer, and plant-eating insects are the watershed's primary consumers.",
  },
  secondaryConsumer: {
    term: "Secondary Consumer",
    short: "Cougars are secondary consumers: they eat the primary consumers that eat plants.",
    long: "Secondary consumers eat primary consumers. A cougar hunting a deer is a secondary consumer -- it gets its energy indirectly from plants, through the deer that ate them.",
  },
  tertiaryConsumer: {
    term: "Tertiary Consumer",
    short: "Apex predators like the wolf pack are tertiary consumers at the top of the chain.",
    long: "Tertiary consumers eat secondary consumers and sit at or near the top of the food chain. An orca preying on a seal that ate salmon, or a wolf pack displacing a cougar, are tertiary-consumer relationships in the watershed.",
  },
  energyTransfer: {
    term: "Energy Transfer",
    short: "Energy pyramids shrink at each level -- only ~10% passes up, so top predators are rare.",
    long: "Energy transfers from one trophic level to the next when an organism is eaten, but most of it (about 90%) is lost as heat or used for the eater's own life processes. Only roughly 10% passes to the next level -- which is why there are always far fewer predators than prey.",
  },
  matterCycling: {
    term: "Cycling of Matter",
    short: "Salmon carry ocean nutrients upstream -- bears and eagles spread them into the forest.",
    long: "Unlike energy, matter cycles endlessly through an ecosystem rather than being lost. Spawning salmon carry ocean-derived nitrogen upriver; bears and eagles drag carcasses into the forest; decomposers return those nutrients to the soil -- and trees near salmon streams measurably grow faster because of it.",
  },
  limitingFactor: {
    term: "Limiting Factor",
    short: "Soil, water, and sunlight are abiotic factors -- when one runs short, it limits growth.",
    long: "A limiting factor is any resource -- water, sunlight, nesting space, food -- that's in short enough supply to cap a population's growth. In drought, water becomes the Driftmoss Watershed's limiting factor: less water means less plant growth, which means fewer herbivores, which means fewer predators.",
  },
  competition: {
    term: "Competition",
    short: "In drought, water becomes scarce -- plants and animals compete harder for what's left.",
    long: "Competition happens when two or more organisms need the same limited resource -- sunlight, water, territory, prey. When a limiting factor tightens, competition intensifies, whether between two elk herds or between a cougar and a wolf pack hunting the same deer.",
  },
  sustainability: {
    term: "Sustainability",
    short: "Reviving one plant can support a whole population above it -- sustainability starts small.",
    long: "Sustainability is an ecosystem's ability to maintain its processes and populations over time without collapsing. A sustainable watershed can absorb a disturbance -- a flood, a fire -- and recover, because enough of its biotic and abiotic foundations survive to rebuild from.",
  },
};

// ---------------------------------------------------------------------------
// Species: the food-web roster. Every entry is a real Pacific coastal
// temperate rainforest species playing an ecologically accurate role.
// ---------------------------------------------------------------------------
export const SPECIES = [
  { id: "sitkaSpruce", name: "Sitka Spruce", role: "producer", conceptIds: ["producers", "photosynthesis"], line: "Sitka spruce are producers -- towering trees that turn sunlight into the energy this whole food web runs on." },
  { id: "swordFern", name: "Sword Fern", role: "producer", conceptIds: ["producers", "photosynthesis"], line: "Sword ferns carpet the forest floor, photosynthesizing in the dim light that reaches the understory." },
  { id: "elk", name: "Roosevelt Elk", role: "primaryConsumer", conceptIds: ["herbivore", "primaryConsumer"], line: "Roosevelt elk are herbivores and primary consumers -- they eat producers like shrubs directly." },
  { id: "deer", name: "Black-tailed Deer", role: "primaryConsumer", conceptIds: ["herbivore", "primaryConsumer"], line: "Black-tailed deer browse on ferns and shrubs -- herbivores feeding straight off the producers." },
  { id: "cougar", name: "Cougar", role: "secondaryConsumer", conceptIds: ["carnivore", "secondaryConsumer"], line: "Cougars are carnivores and secondary consumers, hunting elk and deer for energy." },
  { id: "wolf", name: "Gray Wolf", role: "tertiaryConsumer", conceptIds: ["carnivore", "tertiaryConsumer"], line: "Wolf packs hunt in numbers that let them take down even large elk -- tertiary consumers at the top." },
  { id: "bear", name: "Black Bear", role: "omnivore", conceptIds: ["omnivore", "matterCycling"], line: "Black bears are omnivores -- salmon, berries, and insects -- and drag salmon into the forest, fertilizing it." },
  { id: "eagle", name: "Bald Eagle", role: "scavenger", conceptIds: ["scavenger", "tertiaryConsumer"], line: "Bald eagles hunt fish but also scavenge salmon carcasses, linking the river food web to the forest." },
  { id: "slug", name: "Banana Slug", role: "detritivore", conceptIds: ["detritivore", "decomposers"], line: "Banana slugs are detritivores, shredding fallen leaves into pieces fungi can finish decomposing." },
  { id: "fungus", name: "Nurse-Log Fungus", role: "decomposer", conceptIds: ["decomposers", "organicMatter"], line: "Fungi on a fallen 'nurse log' are decomposers, breaking dead wood into soil nutrients for new seedlings." },
  { id: "salmon", name: "Pacific Salmon", role: "keystone", conceptIds: ["matterCycling", "foodWeb"], line: "Salmon carry ocean nutrients upstream -- their spawning run feeds the entire watershed, start to end." },
];

// ---------------------------------------------------------------------------
// Attacks/abilities -> concept banner (every line <=100 chars, enforced by
// the showConceptBanner() caller in understoryGame.js truncating defensively,
// but authored short on purpose).
// ---------------------------------------------------------------------------
// Each attack maps to an ordered *list* of concepts, not a single one: the
// engine shows whichever the player has seen the fewest times, so repeated
// attacks keep teaching new terms (biotic, abiotic, habitat...) instead of
// repeating the same line, and every term gets taught before any repeats.
export const ATTACK_CONCEPTS = {
  // Tendril Whip hits living plant-matter -- producer/abiotic-themed terms.
  tendrilWhip: ["producers", "photosynthesis", "biotic", "abiotic", "habitat"],
  // Spore Burst seeds fungi -- decomposer/recycling-themed terms.
  sporeBurst: ["decomposers", "organicMatter", "detritivore", "matterCycling"],
  // Reviving a flower restores a producer -- ecosystem-scale terms.
  reviveFlower: ["sustainability", "population", "community", "ecosystem", "species"],
};

// ---------------------------------------------------------------------------
// Zones. `ground`/`platforms` are world-space rects {x,y,w,h}. One shared
// GROUND_Y-relative layout style across zones keeps the physics simple.
// Only `oldGrowth` (hub) and `riverValley` have full playable layouts in
// this build; the remaining 6 exist as data stubs with a locked gate in the
// hub, filled in in later stages per the project plan.
// ---------------------------------------------------------------------------
export const ZONES = {
  oldGrowth: {
    id: "oldGrowth",
    name: "Old-Growth Forest",
    isHub: true,
    disaster: "Wildfire",
    bossId: "cinder",
    width: 2600,
    height: 620,
    spawn: { x: 120, y: 440 },
    introConcept: "habitat",
    // withered/sky = the gloomy-but-readable starting state; living/skyLiving
    // = fully restored. The scene blends between them as flowers are revived
    // and the boss is beaten, so brightness itself tracks progress.
    palette: {
      withered: "#5b4a37",
      living: "#3f8a47",
      sky: ["#6a5f4d", "#3b3227"],
      skyLiving: ["#8fd2b2", "#f4e8b4"],
      tree: "#2f3b2b",
      treeLiving: "#3f7a45",
    },
    // Platform rises are all <= ~55px so every one is reachable: max jump
    // height is v^2/2g = 520^2/(2*1600) ~= 84px.
    ground: [
      { x: 0, y: 500, w: 2600, h: 120 },
      { x: 700, y: 440, w: 170, h: 22 },
      { x: 930, y: 385, w: 170, h: 22 },
      { x: 1180, y: 335, w: 170, h: 22 },
      { x: 1700, y: 435, w: 220, h: 22 },
    ],
    // Flower y = the surface its stem is rooted in (ground/platform top).
    flowers: [
      { id: "og1", x: 300, y: 500 },
      { id: "og2", x: 1015, y: 385 },
      { id: "og3", x: 2250, y: 500 },
    ],
    // Wildlife returns as green reaches it (see "requires", a 0-1 local
    // restoration threshold) -- the biotic recovery that follows reviving
    // producers. y = the surface it stands on.
    critters: [
      { id: "og-elk", speciesId: "elk", kind: "elk", x: 430, y: 500, facing: 1, requires: 0.35 },
      { id: "og-log", speciesId: "fungus", kind: "nurseLog", x: 2090, y: 500, facing: 1, requires: 0 },
      { id: "og-slug", speciesId: "slug", kind: "slug", x: 2078, y: 478, facing: 1, requires: 0.35 },
      { id: "og-cougar", speciesId: "cougar", kind: "cougar", x: 2400, y: 500, facing: -1, requires: 0.4 },
    ],
    enemies: [],
    // Gates stand on the ground (y = ground surface) and are walked into;
    // "arrive" is where the player appears in the destination zone.
    gates: [
      { toZone: "riverValley", x: 2520, y: 500, arrive: { x: 170, y: 440 } },
      { toZone: "mountainSlopes", x: 70, y: 500, locked: true, requires: "rootGrip", label: "Root Grip" },
    ],
  },
  riverValley: {
    id: "riverValley",
    name: "River Valley",
    disaster: "Flood",
    bossId: "deluge",
    width: 3000,
    height: 620,
    spawn: { x: 170, y: 440 },
    introConcept: "ecosystem",
    palette: {
      withered: "#7a664a",
      living: "#3b8c6c",
      sky: ["#6f624c", "#40372a"],
      skyLiving: ["#8bd6cf", "#f7ebb8"],
      tree: "#33402f",
      treeLiving: "#3f8a6a",
    },
    // The 80px gaps are the dry river channel; each is jumpable.
    ground: [
      { x: 0, y: 500, w: 1100, h: 120 },
      { x: 1180, y: 460, w: 260, h: 24 },
      { x: 1520, y: 500, w: 900, h: 120 },
      { x: 2500, y: 500, w: 500, h: 120 },
    ],
    flowers: [
      { id: "rv1", x: 260, y: 500 },
      { id: "rv2", x: 1700, y: 500 },
      { id: "rv3", x: 2700, y: 500 },
    ],
    critters: [
      { id: "rv-eagle", speciesId: "eagle", kind: "eagle", x: 430, y: 500, facing: 1, requires: 0.35 },
      { id: "rv-bear", speciesId: "bear", kind: "bear", x: 1810, y: 500, facing: -1, requires: 0.35 },
    ],
    enemies: [
      { id: "rv-silt-1", type: "siltWisp", x: 900, y: 470 },
      { id: "rv-silt-2", type: "siltWisp", x: 2100, y: 470 },
    ],
    bossArena: { x: 2500, y: 500, w: 500, h: 120, entryX: 2560 },
    gates: [{ toZone: "oldGrowth", x: 60, y: 500, arrive: { x: 2380, y: 440 } }],
  },
};

export const ZONE_ORDER = ["oldGrowth", "riverValley"];

// The real watershed has 8 disaster zones; only 1 (River Valley/Flood) has a
// fully built boss so far, with the rest following in later stages against
// the now-proven template. This must stay false until every canonical zone
// below is authored with a real boss in BOSSES -- the engine's ending check
// uses this as a hard gate so clearing whichever zones *do* exist yet can
// never be mistaken for finishing the whole game.
export const ALL_ZONES_AUTHORED = false;
export const CANONICAL_DISASTER_ZONE_IDS = [
  "riverValley",
  "mountainSlopes",
  "alpineHeadwaters",
  "subalpineForest",
  "oldGrowth",
  "seaCliffs",
  "volcanicRidge",
  "coastalWetland",
];

// ---------------------------------------------------------------------------
// Bosses. Only `deluge` is fully built this pass -- the rest are data
// placeholders future stages fill in against the same reusable fight engine.
// ---------------------------------------------------------------------------
export const BOSSES = {
  deluge: {
    id: "deluge",
    name: "Deluge, the Flood Dragon",
    zoneId: "riverValley",
    maxHp: 10,
    tier: 1,
    unlockAbility: "gillStep",
    unlockLabel: "Gill-Step",
    restorationFrom: "#7a664a",
    restorationTo: "#8bd6cf",
    // Cycled (least-seen first) as hits land -- the consumer/energy/limits
    // terms that the combat itself illustrates (a flood resets who can live
    // here, who competes for what's left, and how energy moves through it).
    concepts: ["foodWeb", "competition", "limitingFactor", "energyTransfer", "foodChain", "consumers"],
    attacks: [
      { id: "waterBolt", telegraphMs: 550, type: "projectile", speed: 260 },
      { id: "tailSweep", telegraphMs: 650, type: "melee", range: 150 },
      { id: "floodWave", telegraphMs: 800, type: "ground", width: 260 },
    ],
    introLine: "A flood dragon, coiled from the river itself, blocks the dry sandbar ahead.",
    defeatLine: "Deluge's waters finally soak into the sand -- the river valley can breathe.",
  },
};

export const JOURNAL_SECTIONS = [
  { title: "The Driftmoss Watershed", conceptIds: ["ecosystem", "habitat"] },
  { title: "Who Lives Here", conceptIds: ["species", "population", "community"] },
  { title: "Producers & Photosynthesis", conceptIds: ["producers", "photosynthesis", "abiotic"] },
  { title: "Consumers", conceptIds: ["consumers", "herbivore", "carnivore", "omnivore", "primaryConsumer", "secondaryConsumer", "tertiaryConsumer"] },
  { title: "Decomposers & Scavengers", conceptIds: ["decomposers", "detritivore", "scavenger", "organicMatter"] },
  { title: "Food Webs & Energy", conceptIds: ["foodChain", "foodWeb", "energyTransfer", "matterCycling"] },
  { title: "Limits & Balance", conceptIds: ["limitingFactor", "competition", "sustainability", "biotic"] },
];
