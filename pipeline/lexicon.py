"""Hand-curated word lists: function words, junk tokens and content we keep out of a family game."""

STOPWORDS = set("""
the and for that with was are but not you all can had her his has have him she they them their there then than
this these those from were been being will would could should shall may might must who whom whose which what when
where why how its our out off over under into onto upon about above after again against also any because before
below between both down during each few further here how more most other same some such only own once very just
now even still yet too via per etc ago among within without whether either neither nor while until unless since
though although whereas whenever wherever whatever whichever whoever anyone anything everyone everything nobody
nothing someone something one two three four five six seven eight nine ten eleven twelve hundred thousand million
billion first second third fourth fifth last next many much several another else instead however therefore thus
hence meanwhile moreover furthermore nevertheless nonetheless otherwise perhaps maybe already always never often
sometimes usually really quite rather almost enough less least around along toward towards throughout behind beside
besides beyond inside outside near far like unlike let get got gets getting make made makes making say said says
saying told tell tells take took taken takes taking come came comes coming going goes went gone done doing does did
put puts set sets use used uses using want wants wanted need needs needed seem seems seemed look looks looked
new old good bad big small little long short high low great best better worse worst able way ways thing things
people man men woman women well back sure yes yeah okay ain don didn doesn isn wasn aren weren won wouldn couldn
shouldn hasn haven hadn mustn lot lots kind sort sorts part parts number numbers time times year years day days
mr mrs ms dr jr sr vs inc ltd corp co www http https com org net edu gov html
""".split())

# Content we don't want to surface at all: slurs, profanity, sexual and graphically violent terms.
BLOCKLIST = set("""
fuck fucking fucked fucker shit shitty bitch bitches bastard asshole ass arse damn damned crap piss pissed dick
cock cocks pussy cunt slut sluts whore whores hooker prostitute prostitution porn porno pornography pornographic
sex sexy sexual sexuality sexually erotic erotica orgasm nude nudity naked topless stripper strip lesbian gay
homosexual homosexuality bisexual transgender rape raped raping rapist molest molested molestation pedophile
paedophile incest nigger nigga negro retard retarded faggot fag dyke tranny chink gook spic kike wetback
genital genitals penis vagina vaginal anus anal breast breasts nipple nipples boob boobs butt buttocks
masturbation masturbate condom condoms aroused arousal fetish bdsm kinky lust lustful lewd obscene vulgar profanity
swear swearing cursing curse cursed
suicide suicidal killing killed kill kills killer killers murder murdered murderer murders slaughter slaughtered
massacre massacred genocide holocaust torture tortured torturing execution executed beheaded beheading decapitated
terrorist terrorists terrorism terror bomber bombers bombing bombings bombed bomb bombs explosive explosives
hostage hostages abducted abduction kidnapped kidnapping kidnap assassination assassinated assassin assassins
shooting shootings shot gunman gunmen gunfire massacre stabbed stabbing stab lynch lynching
nazi nazis nazism hitler fascist fascism jihad jihadist jihadists isis taliban qaeda alqaeda bin laden
cocaine heroin meth methamphetamine crack cannabis marijuana weed narcotics narcotic drug drugs dealer dealers
overdose addict addicts addiction
abortion abortions
corpse corpses cadaver mutilated mutilation gore gory bloody bloodshed
slave slaves slavery
racist racism racial sexist sexism bigot bigotry hate hatred
died dying dies death deaths dead deadly fatal fatally casualties casualty wounded injured injuries
attack attacks attacked attacker attackers assault assaulted
victim victims abuse abused abusive abuser
""".split())

# News-wire / web / boilerplate tokens that leak in from GloVe's Gigaword corpus
JUNK = set("""
reuters afp ap upi xinhua tass ians ians pti gmt utc est pst edt cst mst monday tuesday wednesday thursday friday
saturday sunday jan feb mar apr jun jul aug sep sept oct nov dec percent pct
spokesman spokeswoman spokesperson told according reported reports reporting reporter reporters editor editors
newspaper newspapers agency agencies daily weekly monthly annual quarterly officials official ministry
ministers minister parliament parliamentary lawmakers legislature legislators
said says added noted stated announced declared
mon tue wed thu fri sat sun
online website websites blog blogs email emails
photo photos photograph photographs
copyright rights reserved
ii iii iv vi vii viii ix xi xii
""".split())

# Words that read as bland/abstract "hub" filler and make poor puzzle endpoints
ABSTRACT_ENDPOINT_BLOCK = set("""
thing things stuff way ways kind sort type types form forms part parts area areas level levels case cases fact facts
point points issue issues problem problems matter matters idea ideas reason reasons result results effect effects
process processes system systems approach method methods aspect factor factors term terms basis role roles
""".split())

MONTHS = set("january february march april june july august september october november december".split())
JUNK |= MONTHS

# Demonyms / language adjectives: they clump into tight cliques and make dull puzzle words
DEMONYMS = set("""
american british chinese french german japanese russian italian spanish dutch greek swiss thai korean indian
english irish scottish welsh canadian australian mexican brazilian african asian european arab arabic israeli
iraqi iranian afghan pakistani turkish egyptian polish swedish norwegian danish finnish portuguese cuban
vietnamese indonesian filipino malaysian saudi syrian lebanese palestinian kurdish jewish muslim christian hindu
buddhist catholic protestant islamic latin nordic baltic slavic balkan soviet serbian croatian bosnian ukrainian
czech hungarian romanian bulgarian albanian kenyan nigerian ethiopian somali sudanese libyan moroccan algerian
tunisian ghanaian zimbabwean colombian venezuelan argentine chilean peruvian bolivian haitian jamaican
palestinians israelis iraqis iranians afghans taiwanese tibetan mongolian nepalese lankan bangladeshi burmese
armenian georgian azerbaijani kazakh uzbek chechen yugoslav hispanic caucasian oriental western eastern northern
southern midwestern
""".split())

# Ultra-generic surnames / first names that read as "some person" rather than a famous one
GENERIC_NAMES = set("""
smith jones williams johnson brown davis miller wilson moore taylor anderson thomas jackson white harris martin
thompson garcia martinez robinson clark rodriguez lewis lee walker hall allen young king wright scott green baker
adams nelson hill campbell mitchell roberts carter phillips evans turner torres parker collins edwards stewart
morris murphy cook rogers morgan cooper peterson reed bailey bell kelly howard ward cox richardson wood watson
brooks bennett gray james reyes cruz hughes price myers long foster sanders ross morales powell sullivan russell
ortiz jenkins gutierrez perry butler barnes fisher henderson coleman simmons patterson jordan reynolds hamilton
graham kim gonzales alexander ramos wallace griffin west cole hayes chavez gibson bryant ellis stevens murray ford
marshall owens mcdonald harrison ruiz kennedy wells alvarez woods mendoza castillo olson webb washington tucker
freeman burns henry vasquez snyder simpson crawford jimenez porter mason shaw gordon wagner hunter romero hicks
dixon hunt palmer robertson black holmes stone meyer boyd mills warren fox rose rice moreno schmidt patel ferguson
nichols herrera medina ryan fernandez weaver daniels stephens gardner payne kelley dunn pierce arnold tran spencer
peters hawkins grant hansen castro hoffman hart elliott cunningham knight bradley
""".split())

JUNK |= set("dos aus mas das las rom gen bros pts ext fla ave blvd mph rpm lbs".split())

BLOCKLIST |= set("explosion explosions blast blasts grenade grenades mortar mortars shrapnel landmine landmines bayonet insurgent insurgents insurgency militant militants rebels rebel checkpoint roadside troops gunmen warplanes airstrike airstrikes missile missiles warhead warheads".split())

# ---- second pass, from auditing the built graph against a real profanity list (better-profanity)
BLOCKLIST |= set("""
cum semen sperm homo gays lesbians urine vomit junkie pimp thug queer virgin uterus womb paddy snuff hump suck jerk
stupid pee tramp hooters playboy knob sniper opium seaman thrust oral facial gypsy redneck ghetto mistress brothel
thong lingerie stripper hooker
""".split())

# words that list flags but are perfectly ordinary here (organ = instrument, screw = tool, hell = a place in idioms...)
PROFANITY_ALLOW = set("hell dummy hemp pot rum vodka organ stroke screw slope maxi fat".split())

try:
    from better_profanity import profanity as _p

    _p.load_censor_words()

    def flagged(word):
        """True if the well-known better-profanity list flags this word (minus our allow-list)."""
        return word not in PROFANITY_ALLOW and _p.contains_profanity(word)
except Exception:  # package missing: the hand-made lists above still apply

    def flagged(word):
        return False

BLOCKLIST |= set("slain slaying killings noose minefield adultery blockade cartel gallows hanging hanged lynching massacres".split())

# Common-Crawl (GloVe 840B) picks up foreign function words with high raw frequency; these have no real
# standalone English meaning even though they pass the zipf/WordNet checks (WordNet: "des" as DES the drug, "sur" not at all)
# Common-Crawl (GloVe 840B) picks up a cluster of French function words with high raw frequency; they have no real
# standalone English meaning even though a few pass the zipf/WordNet checks via an obscure English homograph
# (des=DES the drug, cas=calcium/CA abbrev., plus=asset, rouge=makeup, para=parity, blanc/beau/rue/tout=rare/archaic).
JUNK |= set("des sur cas tout plus rouge para blanc beau rue".split())
