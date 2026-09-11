export type PredictedPlayer = {
  name: string
  role: string
}

export type PredictedTeam = {
  formation: string
  sourceLabel: string
  confidence: "predicted" | "recent-xi-fallback" | "conflicting-predicted"
  players: PredictedPlayer[]
}

export type PredictedFixture = {
  date: string
  home: string
  away: string
  teams: Record<string, PredictedTeam>
}

const team = (
  formation: string,
  players: Array<[string, string]>,
  sourceLabel: string,
  confidence: PredictedTeam["confidence"] = "predicted",
): PredictedTeam => ({ formation, sourceLabel, confidence, players: players.map(([name, role]) => ({ name, role })) })

export const predictedFixtures: PredictedFixture[] = [
  {
    date: "2026-09-12", home: "Aston Villa", away: "Nottingham Forest", teams: {
      "Aston Villa": team("4-2-3-1", [["Zion Suzuki","GK"],["Matty Cash","RB"],["Pau Torres","RCB"],["Victor Lindelof","LCB"],["Ian Maatsen","LB"],["Boubacar Kamara","RDM"],["Tyrone Mings","LDM"],["Emiliano Buendia","RW"],["John McGinn","CAM"],["Ross Barkley","LW"],["Nicolas Jackson","ST"]], "Starting11 predicted XI · 11 Sep 2026"),
      "Nottingham Forest": team("3-4-2-1", [["Matz Sels","GK"],["Jair Cunha","RCB"],["Nikola Milenkovic","CB"],["Murillo","LCB"],["Ola Aina","RWB"],["Xaver Schlager","RCM"],["James McAtee","LCM"],["Neco Williams","LWB"],["Morgan Gibbs-White","RAM"],["Dan Ndoye","LAM"],["Igor Jesus","ST"]], "Recent confirmed XI / most-used fallback · 5 Sep 2026", "recent-xi-fallback"),
    }
  },
  {
    date: "2026-09-12", home: "AFC Bournemouth", away: "Brentford", teams: {
      "AFC Bournemouth": team("4-2-3-1", [["Djordje Petrovic","GK"],["Adam Smith","RB"],["James Hill","RCB"],["Antonio Silva","LCB"],["Adrien Truffert","LB"],["Tyler Adams","RDM"],["Alex Scott","LDM"],["Rayan","RW"],["Justin Kluivert","CAM"],["Marcus Tavernier","LW"],["Evanilson","ST"]], "Tipsters/Freetips consensus predicted XI · 10 Sep 2026"),
      Brentford: team("4-2-3-1", [["Caoimhin Kelleher","GK"],["Michael Kayode","RB"],["Kristoffer Ajer","RCB"],["Benjamin Schuster","LCB"],["Keane Lewis-Potter","LB"],["Ibrahim Sangare","RDM"],["Vitaly Janelt","LDM"],["Dango Ouattara","RW"],["Mikkel Damsgaard","CAM"],["Kevin Schade","LW"],["Igor Thiago","ST"]], "Tipsters predicted XI · 10 Sep 2026"),
    }
  },
  {
    date: "2026-09-12", home: "Chelsea", away: "Hull City", teams: {
      Chelsea: team("3-4-2-1", [["Emiliano Martinez","GK"],["Maxence Lacroix","RCB"],["Levi Colwill","CB"],["Malo Gusto","LCB"],["Reece James","RWB"],["Romeo Lavia","RCM"],["Jorrel Hato","LCM"],["Pedro Neto","LWB"],["Cole Palmer","RAM"],["Morgan Rogers","LAM"],["Joao Pedro","ST"]], "Starting11 predicted XI · 11 Sep 2026"),
      "Hull City": team("4-3-2-1", [["Konstantinos Tzolakis","GK"],["Lewie Coyle","RB"],["John Egan","RCB"],["Semi Ajayi","LCB"],["Nobel Mendy","LB"],["Regan Slater","RCM"],["Ryan Giles","CM"],["Mohamed Belloumi","LCM"],["Lucien Agoume","RAM"],["Kristian Hjerto-Dahl","LAM"],["Elliot Stroud","ST"]], "Starting11 predicted XI · 11 Sep 2026"),
    }
  },
  {
    date: "2026-09-12", home: "Crystal Palace", away: "Ipswich Town", teams: {
      "Crystal Palace": team("3-4-2-1", [["Walter Benitez","GK"],["Takehiro Tomiyasu","RCB"],["Axel Disasi","CB"],["Jaydee Canvot","LCB"],["Hamad Khalaili","RWB"],["Jefferson Lerma","RCM"],["Quinten Timber","LCM"],["Tyrick Mitchell","LWB"],["Yeremy Pino","RAM"],["Daichi Kamada","LAM"],["Evann Guessand","ST"]], "Starting11 Oracle · 11 Sep 2026; crowd differs materially", "conflicting-predicted"),
      "Ipswich Town": team("4-2-3-1", [["Kjell Scherpen","GK"],["Dara O'Shea","RB"],["Issa Diop","RCB"],["Jacob Greaves","LCB"],["Leif Davis","LB"],["Sasa Lukic","RDM"],["Exequiel Palacios","LDM"],["Abdul Fatawu","RW"],["Julio Enciso","CAM"],["Daizen Maeda","LW"],["Emersonn","ST"]], "Starting11 Oracle · 11 Sep 2026; crowd differs", "conflicting-predicted"),
    }
  },
  {
    date: "2026-09-12", home: "Liverpool", away: "Fulham", teams: {
      Liverpool: team("4-2-3-1", [["Alisson Becker","GK"],["Jeremie Frimpong","RB"],["Virgil van Dijk","RCB"],["Jeremy Jacquet","LCB"],["Milos Kerkez","LB"],["Alexis Mac Allister","RDM"],["Dominik Szoboszlai","LDM"],["Victor Munoz","RW"],["Florian Wirtz","CAM"],["Cody Gakpo","LW"],["Alexander Isak","ST"]], "Starting11 predicted XI · 11 Sep 2026"),
      Fulham: team("4-2-3-1", [["Bernd Leno","GK"],["Timothy Castagne","RB"],["Jorge Cuenca","RCB"],["Calvin Bassey","LCB"],["Ryan Sessegnon","LB"],["Sander Berge","RDM"],["Shea Charles","LDM"],["Oscar Bobb","RW"],["Cesar Palacios","CAM"],["Josh King","LW"],["Gonzalo Garcia","ST"]], "Starting11 predicted XI · 11 Sep 2026"),
    }
  },
  {
    date: "2026-09-12", home: "Tottenham Hotspur", away: "Everton", teams: {
      "Tottenham Hotspur": team("4-2-3-1", [["Antonin Kinsky","GK"],["Pedro Porro","RB"],["Jan Paul van Hecke","RCB"],["Micky van de Ven","LCB"],["Destiny Udogie","LB"],["Sandro Tonali","RDM"],["Mateus Fernandes","LDM"],["Savio","RW"],["Mohammed Kudus","CAM"],["Mathys Tel","LW"],["Omar Marmoush","ST"]], "Starting11 predicted XI · 11 Sep 2026; alternative source flags several injury doubts", "conflicting-predicted"),
      Everton: team("4-2-3-1", [["Jordan Pickford","GK"],["Merlin Rohl","RB"],["Jarrad Branthwaite","RCB"],["Jake O'Brien","LCB"],["Vitalii Mykolenko","LB"],["Harrison Armstrong","RDM"],["Hayden Hackney","LDM"],["Kiernan Dewsbury-Hall","RW"],["Jack Grealish","CAM"],["Tyrique George","LW"],["Thierno Barry","ST"]], "Starting11 predicted XI · 11 Sep 2026; alternative source differs", "conflicting-predicted"),
    }
  },
  {
    date: "2026-09-12", home: "Sunderland", away: "Arsenal", teams: {
      Sunderland: team("4-2-3-1", [["Robin Roefs","GK"],["Nordi Mukiele","RB"],["Kevin Danso","RCB"],["Dan Ballard","LCB"],["Reinildo Mandava","LB"],["Granit Xhaka","RDM"],["Noah Sadiki","LDM"],["Enzo Le Fee","RW"],["Nilson Angulo","CAM"],["Malick Fofana","LW"],["Brian Brobbey","ST"]], "Starting11/Sports Mole predicted XI · 10-11 Sep 2026"),
      Arsenal: team("4-2-3-1", [["David Raya","GK"],["Ben White","RB"],["Ezri Konsa","RCB"],["Gabriel Magalhaes","LCB"],["Riccardo Calafiori","LB"],["Declan Rice","RDM"],["Kai Havertz","LDM"],["Bukayo Saka","RW"],["Eberechi Eze","CAM"],["Martin Odegaard","LW"],["Viktor Gyokeres","ST"]], "Starting11 crowd predicted XI · 11 Sep 2026; Oracle differs by two", "conflicting-predicted"),
    }
  },
  {
    date: "2026-09-13", home: "Coventry City", away: "Brighton & Hove Albion", teams: {
      "Coventry City": team("3-4-2-1", [["Carl Rushworth","GK"],["Aurele Amenda","RCB"],["Jay Dasilva","CB"],["Bobby Thomas","LCB"],["Caleb Yirenkyi","RWB"],["Frank Onyeka","RCM"],["Matt Grimes","LCM"],["Joel Latibeaudiere","LWB"],["Victor Torp","RAM"],["Jack Rudoni","LAM"],["Taiwo Awoniyi","ST"]], "Starting11/ScoresAndStats predicted XI · 9-10 Sep 2026"),
      "Brighton & Hove Albion": team("4-2-3-1", [["Bart Verbruggen","GK"],["Ferdi Kadioglu","RB"],["Luka Vuskovic","RCB"],["Lewis Dunk","LCB"],["Pascal Struijk","LB"],["Pascal Gross","RDM"],["Yasin Ayari","LDM"],["Malick Yalcouye","RW"],["Diego Gomez","CAM"],["Maxim De Cuyper","LW"],["Charalampos Kostoulas","ST"]], "Starting11/ScoresAndStats predicted XI · 9-10 Sep 2026"),
    }
  },
  {
    date: "2026-09-13", home: "Manchester United", away: "Manchester City", teams: {
      "Manchester United": team("4-2-3-1", [["Senne Lammens","GK"],["Diogo Dalot","RB"],["Harry Maguire","RCB"],["Lisandro Martinez","LCB"],["Luke Shaw","LB"],["Youri Tielemans","RDM"],["Kobbie Mainoo","LDM"],["Bryan Mbeumo","RW"],["Bruno Fernandes","CAM"],["Marcus Rashford","LW"],["Matheus Cunha","ST"]], "Starting11 crowd + ScoresAndStats consensus · 10-11 Sep 2026"),
      "Manchester City": team("4-2-3-1", [["Gianluigi Donnarumma","GK"],["Abdukodir Khusanov","RB"],["Ruben Dias","RCB"],["Marc Guehi","LCB"],["Josko Gvardiol","LB"],["Elliot Anderson","RDM"],["Enzo Fernandez","LDM"],["Phil Foden","RW"],["Rayan Cherki","CAM"],["Antoine Semenyo","LW"],["Erling Haaland","ST"]], "Starting11 crowd / ScoresAndStats · one midfield slot disputed", "conflicting-predicted"),
    }
  },
  {
    date: "2026-09-14", home: "Leeds United", away: "Newcastle United", teams: {
      "Leeds United": team("3-4-2-1", [["James Trafford","GK"],["James Justin","RCB"],["Nico Elvedi","CB"],["Tarik Muharemovic","LCB"],["Jayden Bogle","RWB"],["Ethan Ampadu","RCM"],["Ao Tanaka","LCM"],["Gabriel Gudmundsson","LWB"],["Anton Stach","RAM"],["Noah Okafor","LAM"],["Dominic Calvert-Lewin","ST"]], "Starting11 Oracle revision 3 · 6 Sep 2026", "predicted"),
      "Newcastle United": team("4-2-3-1", [["Michal Hornicek","GK"],["Amar Dedic","RB"],["Malick Thiaw","RCB"],["Sven Botman","LCB"],["Lewis Hall","LB"],["Jacob Gonzalez","RDM"],["Lewis Miley","LDM"],["Anthony Elanga","RW"],["Joe Willock","CAM"],["Harvey Barnes","LW"],["Yoane Wissa","ST"]], "Starting11 Oracle revision 2 / recent confirmed XI · 6-8 Sep 2026", "predicted"),
    }
  },
]

export function normalisePredictedName(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")
}

export function getPredictedFixture(date: string, home: string, away: string) {
  const n = normalisePredictedName
  return predictedFixtures.find((fixture) => fixture.date === date && n(fixture.home) === n(home) && n(fixture.away) === n(away)) ?? null
}

export function getPredictedPlayer(teamData: PredictedTeam | undefined, name: string) {
  if (!teamData) return null
  const target = normalisePredictedName(name)
  return teamData.players.find((player) => {
    const candidate = normalisePredictedName(player.name)
    return candidate === target || candidate.includes(target) || target.includes(candidate)
  }) ?? null
}

export function directOpponentRoles(role: string) {
  const r = role.toUpperCase()
  const map: Record<string, string[]> = {
    LB: ["RW", "RAM", "RM", "RWB"], LWB: ["RW", "RAM", "RM", "RWB"],
    RB: ["LW", "LAM", "LM", "LWB"], RWB: ["LW", "LAM", "LM", "LWB"],
    LCB: ["ST", "CF", "RST", "RW", "RAM"], RCB: ["ST", "CF", "LST", "LW", "LAM"], CB: ["ST", "CF", "RST", "LST"],
    RDM: ["LAM", "CAM", "LCM"], LDM: ["RAM", "CAM", "RCM"], CDM: ["CAM", "AM", "CM"], DM: ["CAM", "AM", "CM"],
    RCM: ["LAM", "LCM", "CAM"], LCM: ["RAM", "RCM", "CAM"], CM: ["CM", "CAM", "AM"],
    CAM: ["CDM", "DM", "CM", "RDM", "LDM"], AM: ["CDM", "DM", "CM"],
    LW: ["RB", "RWB", "RCB"], LAM: ["RB", "RWB", "RCB"], LM: ["RB", "RWB"],
    RW: ["LB", "LWB", "LCB"], RAM: ["LB", "LWB", "LCB"], RM: ["LB", "LWB"],
    ST: ["CB", "LCB", "RCB"], CF: ["CB", "LCB", "RCB"], RST: ["LCB", "CB"], LST: ["RCB", "CB"],
  }
  return map[r] ?? []
}
