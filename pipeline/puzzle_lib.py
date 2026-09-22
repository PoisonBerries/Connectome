import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import shortest_path
from lexicon import ABSTRACT_ENDPOINT_BLOCK

CONCRETE_CATS = {"noun.animal", "noun.food", "noun.artifact", "noun.plant", "noun.object", "noun.natural_object",
                 "noun.substance", "noun.body", "noun.person", "noun.location", "noun.shape"}

# ambiguous / awkward as a puzzle endpoint (still fine as an in-between hop)
ENDPOINT_EXCLUDE = set("""
frost wells christie prince bolt wilde hood chan lee oscar hugo jordan georgia dakota carolina phoenix mercury orion
mali oman panama titan trojan maya roman spartan mongol viking columbus curiosity challenger endeavour voyager polaris
sirius andromeda cassiopeia pleiades halley kobe shaq serena tyson leonardo donald mickey minnie nemo simba
matrix avatar frozen jaws rocky ronaldo bono adele madonna seuss poe dali homer dante nero attila genghis
turkey jersey mexico=x rhode hampshire washington
""".split())

ENDPOINT_EXCLUDE |= set("""
ordinary young humans hearts cups assembly communist subsidiary portfolio spam starter holder employer embassy vintage
mate nominee candidate supervisor executive veteran server sensor soundtrack outlet loop counter console grocery
cardinal chancellor prosecutor senator governor mayor president politician ambassador lieutenant sergeant colonel
commander admiral officer secretary manager director boss employee clerk worker leader chief captain master
container structure device instrument machinery liquor alcohol petroleum vitamin platinum aluminum copper diet
weapon vessel vehicle fabric furniture intuition
auto bath bathroom bedroom chamber chest circuit coach frame foot game hand head food fruit dish meal gear hero monitor
office pocket room store suit tank tail tissue toilet trap wall wheel window wing skin sport shelter flesh button bow
muscle mouth neck shoulder knee tongue throat stomach auction author journalist writer artist actor actress camp
""".split())

# iconic, picturable words that WordNet's heuristics miss
ENDPOINT_INCLUDE = set("""
dinosaur volcano pyramid dragon pirate robot unicorn tornado hurricane earthquake rainbow snowman jungle desert island
treasure lighthouse submarine telescope microscope umbrella hamburger sandwich popcorn pancake waffle pretzel donut
cupcake lollipop sushi noodle burger taco cheese honey cookie cake candy pumpkin strawberry watermelon cherry
coconut pineapple mushroom carrot tomato cactus bamboo orchid rose sunflower tulip butterfly dolphin whale octopus
penguin kangaroo giraffe zebra panda gorilla cheetah leopard tiger crocodile alligator turtle frog owl parrot flamingo
peacock swan bat spider scorpion jellyfish seahorse lobster crab shrimp oyster camel llama donkey pig cow duck
chimney fireplace bathtub mirror candle ladder anchor compass telescope binoculars camera piano violin trumpet
saxophone harp drum guitar accordion flute jukebox radio television microphone headphones skateboard bicycle
motorcycle scooter tractor bulldozer helicopter airplane balloon parachute rocket satellite astronaut cowboy
detective wizard witch vampire zombie ghost mermaid fairy giant knight king queen prince princess clown magician
circus carnival festival parade fireworks concert orchestra opera theater museum library school hospital stadium
airport harbor bridge tunnel skyscraper windmill castle palace temple mosque church cathedral
snow ice fire storm thunder lightning cloud sunset moonlight meteor comet galaxy eclipse
diamond gold silver treasure crown throne sword shield armor arrow bow
""".split())

# a second wave of everyday, picturable words (foods, animals, buildings, objects, jobs) so the pool isn't mostly proper nouns
ENDPOINT_INCLUDE |= set("""
almond avocado bacon banana barley basil bean biscuit broccoli buffet cabbage caramel cereal chili citrus cocoa corn
cracker cucumber dessert dough garlic ginger gravy herring ketchup lamb lemon lemonade mango mustard oats olive pasta
pastry peach peanut pear pepper plum pork potato pudding raspberry salad salmon sausage seafood sesame soup spaghetti
spinach squash steak syrup toast trout tuna vanilla vinegar walnut wheat yogurt cocktail
bunny cobra crow deer eagle goat hare hound insect lizard moose mosquito moth mule panther pigeon pony python rabbit
rhino serpent shark sheep snail sparrow squid squirrel cattle
aquarium attic auditorium bakery balcony ballroom barn basement bookstore boutique brewery cabin cafe cafeteria canyon
casino cellar chapel classroom cliff clubhouse cottage courthouse courtyard cove crater delta farmhouse fortress
fountain glacier gorge hostel inlet lagoon lobby manor marina monument motel nursery observatory patio pavilion plateau
pond porch saloon seaside strait supermarket tavern tent terrace waterfall willow pine cedar aspen vine violet iris
jasmine lavender poppy rosemary hazel
altar basket canvas cassette chalk charcoal comb costume couch crate crib cupboard cushion denim doll drone envelope
flashlight freezer furnace gong gown hammer handbag heater helm hose jeans jeep kettle lamp lantern leash locker
luggage magnet oven purse saddle scissors shovel shorts silk sofa sock spoon spacecraft suitcase sunglasses sweater
tanker tray trolley trousers vase vault wagon wallet wardrobe wool torch turbine cruiser
bartender comedian composer conductor dancer mechanic miner musician novelist painter pianist sailor songwriter waiter
fisherman chess derby hurdle rink volleyball diva guru
""".split())

# not-so-fun or sensitive endpoints that slipped through the automatic pool rules
ENDPOINT_EXCLUDE |= set("""
ra risk clue lent uno halo sims jung watt morse cook ruth curry hopper turner constable ares zen karma sonnet limerick haiku
booker tony ali eros janus troll ogre goblin elf dwarf sirius pong sega atari kirby yoshi clue scuba compass anchor crown
armor shield helmet throne dungeon
gypsy lingerie underwear boxers trunks diaper asylum dungeon baggage mankind geek
abdomen artery bladder bowel colon cortex cavity fetus uterus womb liver kidney lung marrow nerve retina receptor
calcium lithium magnesium nickel potassium sodium titanium uranium aluminium asbestos
imam rabbi pastor preacher monastery synagogue chaplain archbishop convent
dagger firearm pistol revolver shotgun brandy cider sherry whiskey
""".split())

# -------------------------------------------------------------- themes (for variety)
# Endpoints are sampled by theme first, and two endpoints of the same theme are never paired,
# so a puzzle can't be "Paris -> Austria".
SECTION_THEME = {
    "countries": "place", "continents_regions": "place", "cities": "place", "us_states": "place", "landmarks": "place",
    "history_people": "people", "arts_people": "people", "fiction": "fiction", "mythology": "fiction",
    "brands": "brand", "culture_misc": "culture", "common_phrases": "culture", "space": "space",
    "foods": "food", "creatures": "animal", "games": "culture", "everyday": "object",
}
LABEL_THEME = {
    "animal": "animal", "plant": "plant", "food or drink": "food", "building": "building", "structure": "building",
    "landform": "nature", "waterway": "nature", "space": "nature",
    "job": "people", "performer": "people", "person": "people", "scientist": "people", "artist": "people", "writer": "people",
}
# quick hand overrides where WordNet's first sense misleads (whale -> "a very large person")
THEME_OVERRIDE = {}
for theme, words in {
    "animal": "whale dolphin octopus penguin kangaroo giraffe zebra panda gorilla cheetah leopard tiger crocodile alligator turtle frog owl parrot flamingo peacock swan bat spider scorpion jellyfish lobster crab shrimp oyster camel wolf lion horse pig cow duck chicken snake mouse rabbit dragon unicorn dinosaur puppy bird fish".split(),
    "food": "banana ginger garlic vanilla pepper corn wheat olive almond avocado mango peach pear plum lemon lamb pizza sandwich popcorn pancake waffle pretzel donut cupcake lollipop sushi noodle burger taco cheese honey cookie cake candy chocolate coffee juice beer bread butter rice sugar meat beef pumpkin strawberry watermelon cherry coconut pineapple mushroom carrot tomato orange apple".split(),
    "culture": "chess derby".split(),
    "nature": "volcano earthquake hurricane tornado rainbow snow ice fire storm thunder lightning cloud sunset meteor comet galaxy eclipse ocean river lake mountain island jungle desert valley hill coast".split(),
    "building": "castle palace temple mosque church cathedral hospital stadium airport harbor bridge tunnel skyscraper windmill lighthouse library museum school hotel restaurant prison factory tower pyramid".split(),
    "people": "astronaut cowboy detective wizard witch vampire zombie ghost mermaid fairy giant knight king queen princess clown magician pirate soldier pilot poet singer scientist priest pope".split(),
}.items():
    for w in words:
        THEME_OVERRIDE[w] = theme


def theme_of(G, i):
    w = G["words"][i]
    if G["kinds"][i] != 0:
        return SECTION_THEME.get(G["cats"][i], "culture")
    if w.lower() in THEME_OVERRIDE:
        return THEME_OVERRIDE[w.lower()]
    return LABEL_THEME.get(label_for(w), "object")


def load(path="out/graph.npz"):
    g = np.load(path)
    words = [str(w) for w in g["words"]]
    return dict(words=words, nbrs=g["nbrs"], extras=g["extras"] if "extras" in g.files else None, kinds=g["kinds"], cats=[str(c) for c in g["sections"]],
                zipf=g["zipf"], vecs=g["vecs"], n=len(words))

def adjacency(nb):
    n = nb.shape[0]
    rows = np.repeat(np.arange(n), nb.shape[1])
    return csr_matrix((np.ones(nb.size), (rows, nb.ravel())), shape=(n, n))

from nltk.corpus import wordnet as wn

PICTURABLE = [wn.synset(x) for x in """animal.n.01 plant.n.02 food.n.01 food.n.02 body_part.n.01 clothing.n.01 vehicle.n.01
musical_instrument.n.01 furniture.n.01 building.n.01 device.n.01 container.n.01 weapon.n.01 toy.n.01
geological_formation.n.01 body_of_water.n.01 celestial_body.n.01 craft.n.02 beverage.n.01 dwelling.n.01 tool.n.01
sport.n.01 fabric.n.01 precious_stone.n.01 metal.n.01 fruit.n.01 vegetable.n.01 structure.n.01 gem.n.02 dish.n.02
worker.n.01 fish.n.01 bird.n.01 insect.n.01 tree.n.01 flower.n.01 mineral.n.01 fuel.n.01 appliance.n.02 game.n.01
performer.n.01 leader.n.01 scientist.n.01 artist.n.01 writer.n.01""".split()]

LABEL_OF = {
    "animal.n.01": "animal", "fish.n.01": "animal", "bird.n.01": "animal", "insect.n.01": "animal",
    "plant.n.02": "plant", "tree.n.01": "plant", "flower.n.01": "plant",
    "food.n.01": "food or drink", "food.n.02": "food or drink", "beverage.n.01": "food or drink", "dish.n.02": "food or drink",
    "fruit.n.01": "food or drink", "vegetable.n.01": "food or drink",
    "body_part.n.01": "body part", "clothing.n.01": "clothing", "vehicle.n.01": "vehicle", "craft.n.02": "vehicle",
    "musical_instrument.n.01": "instrument", "furniture.n.01": "furniture", "building.n.01": "building",
    "dwelling.n.01": "building", "structure.n.01": "structure", "device.n.01": "gadget", "tool.n.01": "tool",
    "appliance.n.02": "appliance", "container.n.01": "container", "weapon.n.01": "weapon", "toy.n.01": "toy",
    "game.n.01": "game", "sport.n.01": "sport", "geological_formation.n.01": "landform", "body_of_water.n.01": "waterway",
    "celestial_body.n.01": "space", "worker.n.01": "job", "performer.n.01": "performer", "leader.n.01": "person",
    "scientist.n.01": "scientist", "artist.n.01": "artist", "writer.n.01": "writer", "fabric.n.01": "material",
    "metal.n.01": "material", "mineral.n.01": "material", "gem.n.02": "gem", "precious_stone.n.01": "gem", "fuel.n.01": "material",
}
LABEL_ORDER = list(LABEL_OF)


def label_for(w):
    syn = wn.synsets(w.replace(" ", "_"), pos="n")
    if not syn:
        return ""
    closure = set(syn[0].closure(lambda s: s.hypernyms())) | {syn[0]}
    names = {s.name() for s in closure}
    for k in LABEL_ORDER:
        if k in names:
            return LABEL_OF[k]
    return ""


def picturable(w):
    syn = wn.synsets(w.replace(" ", "_"), pos="n")
    allsyn = wn.synsets(w)
    if not syn or allsyn[0].pos() != "n" or len(syn) / len(allsyn) < 0.6:
        return False
    first = syn[0]
    closure = set(first.closure(lambda s: s.hypernyms())) | {first}
    return any(p in closure for p in PICTURABLE)


def endpoint_pool(G):
    out = []
    for i, w in enumerate(G["words"]):
        lw = w.lower()
        if lw in ENDPOINT_EXCLUDE or lw in ABSTRACT_ENDPOINT_BLOCK:
            continue
        k = G["kinds"][i]
        if k == 0 and lw in ENDPOINT_INCLUDE:
            out.append(i)
            continue
        if k == 0:
            if G["zipf"][i] < 4.2 or not (4 <= len(w) <= 11) or not picturable(w):
                continue
        out.append(i)
    return np.array(out)

def agent_moves(nb, cosrow, s, t, max_moves=80):
    """Best-first 'human-like' player: always step to the unvisited neighbour most similar to the target; back up when stuck."""
    visited = {s}; stack = [s]; moves = 0; cur = s
    while cur != t and moves < max_moves:
        cand = [int(j) for j in nb[cur] if int(j) not in visited]
        if not cand:
            stack.pop()
            if not stack:
                return None
            cur = stack[-1]
            continue
        j = t if t in cand else max(cand, key=lambda j: cosrow[j])
        visited.add(j); stack.append(j); cur = j; moves += 1
    return moves if cur == t else None
