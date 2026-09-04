export type PredictedPlayer = {
  name: string
  role: string
}

export type PredictedTeam = {
  formation: string
  sourceLabel: string
  confidence: "predicted" | "recent-xi-fallback"
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
  sourceLabel = "Sports Mole predicted XI · 4 Sep 2026",
  confidence: PredictedTeam["confidence"] = "predicted",
): PredictedTeam => ({
  formation,
  sourceLabel,
  confidence,
  players: players.map(([name, role]) => ({ name, role })),
})

export const predictedFixtures: PredictedFixture[] = [
  {
    date: "2026-09-04", home: "Ipswich Town", away: "Liverpool", teams: {
      "Ipswich Town": team("4-2-3-1", [["Robin Scherpen","GK"],["Dara O'Shea","RB"],["Issa Diop","RCB"],["Jacob Greaves","LCB"],["Leif Davis","LB"],["Nunez","RDM"],["Sasa Lukic","LDM"],["Abdul Fatawu","RW"],["Julio Enciso","CAM"],["Daizen Maeda","LW"],["Chuba Akpom","ST"]], "Sports Mole predicted XI · 3 Sep 2026"),
      Liverpool: team("4-2-3-1", [["Alisson","GK"],["Jeremie Frimpong","RB"],["Jeremy Jacquet","RCB"],["Virgil van Dijk","LCB"],["Milos Kerkez","LB"],["Alexis Mac Allister","RDM"],["Dominik Szoboszlai","LDM"],["Victor Munoz","RW"],["Florian Wirtz","CAM"],["Cody Gakpo","LW"],["Alexander Isak","ST"]], "Sports Mole predicted XI · 3 Sep 2026"),
    }
  },
  {
    date: "2026-09-05", home: "Newcastle United", away: "AFC Bournemouth", teams: {
      "Newcastle United": team("4-3-3", [["Michal Hornicek","GK"],["Amar Dedic","RB"],["Malick Thiaw","RCB"],["Sven Botman","LCB"],["Lewis Hall","LB"],["Joe Willock","RCM"],["Jacob Gonzalez","DM"],["Lewis Miley","LCM"],["Anthony Elanga","RW"],["Yoane Wissa","ST"],["Harvey Barnes","LW"]]),
      "AFC Bournemouth": team("4-2-3-1", [["Djordje Petrovic","GK"],["Adam Smith","RB"],["James Hill","RCB"],["Antonio Silva","LCB"],["Adrien Truffert","LB"],["Lewis Cook","RDM"],["Alex Scott","LDM"],["Rayan","RW"],["Justin Kluivert","CAM"],["Marcus Tavernier","LW"],["Evanilson","ST"]]),
    }
  },
  {
    date: "2026-09-05", home: "Brentford", away: "Sunderland", teams: {
      Brentford: team("4-2-3-1", [["Caoimhin Kelleher","GK"],["Michael Kayode","RB"],["Kristoffer Ajer","RCB"],["Nathan Collins","LCB"],["Keane Lewis-Potter","LB"],["Vitaly Janelt","RDM"],["Ibrahim Sangare","LDM"],["Dango Ouattara","RW"],["Mikkel Damsgaard","CAM"],["Kevin Schade","LW"],["Igor Thiago","ST"]]),
      Sunderland: team("4-2-3-1", [["Robin Roefs","GK"],["Thomas Meunier","RB"],["Nordi Mukiele","RCB"],["Dan Ballard","LCB"],["Reinildo Mandava","LB"],["Granit Xhaka","RDM"],["Noah Sadiki","LDM"],["Malick Fofana","RW"],["Enzo Le Fee","CAM"],["Nilson Angulo","LW"],["Wilson Isidor","ST"]]),
    }
  },
  {
    date: "2026-09-05", home: "Brighton & Hove Albion", away: "Leeds United", teams: {
      "Brighton & Hove Albion": team("4-2-3-1", [["Bart Verbruggen","GK"],["Costinha","RB"],["Luka Vuskovic","RCB"],["Lewis Dunk","LCB"],["Ferdi Kadioglu","LB"],["Yasin Ayari","RDM"],["Mahamadou Yalcouye","LDM"],["Diego Gomez","RW"],["Pascal Gross","CAM"],["Maxim De Cuyper","LW"],["Georginio Rutter","ST"]]),
      "Leeds United": team("3-4-2-1", [["James Trafford","GK"],["Nico Elvedi","RCB"],["Jaka Bijol","CB"],["Tarik Muharemovic","LCB"],["Jayden Bogle","RWB"],["Anton Stach","RCM"],["Ethan Ampadu","LCM"],["James Justin","LWB"],["Callum Wilson","RAM"],["Noah Okafor","LAM"],["Dominic Calvert-Lewin","ST"]]),
    }
  },
  {
    date: "2026-09-05", home: "Fulham", away: "Crystal Palace", teams: {
      Fulham: team("4-2-3-1", [["Bernd Leno","GK"],["Timothy Castagne","RB"],["Joachim Andersen","RCB"],["Calvin Bassey","LCB"],["Antonee Robinson","LB"],["Sander Berge","RDM"],["Shea Charles","LDM"],["Alex Iwobi","RW"],["Josh King","CAM"],["Cesar Palacios","LW"],["Gonzalo Garcia","ST"]]),
      "Crystal Palace": team("3-4-2-1", [["Dean Henderson","GK"],["Jaydee Canvot","RCB"],["Chris Richards","CB"],["Takehiro Tomiyasu","LCB"],["Hamad Khalaili","RWB"],["Daichi Kamada","RCM"],["Adam Wharton","LCM"],["Tyrick Mitchell","LWB"],["Dwight McNeil","RAM"],["Yeremy Pino","LAM"],["Jorgen Strand Larsen","ST"]]),
    }
  },
  {
    date: "2026-09-05", home: "Manchester City", away: "Coventry City", teams: {
      "Manchester City": team("4-2-3-1", [["Gianluigi Donnarumma","GK"],["Abdukodir Khusanov","RB"],["Ruben Dias","RCB"],["Marc Guehi","LCB"],["Josko Gvardiol","LB"],["Elliot Anderson","RDM"],["Ayyoub Bouaddi","LDM"],["Phil Foden","RW"],["Rayan Cherki","CAM"],["Antoine Semenyo","LW"],["Erling Haaland","ST"]]),
      "Coventry City": team("5-3-2", [["Carl Rushworth","GK"],["Milan van Ewijk","RWB"],["Bobby Thomas","RCB"],["Ethan Pinnock","CB"],["Aurele Amenda","LCB"],["Jay Dasilva","LWB"],["Caleb Yirenkyi","RCM"],["Matt Grimes","CM"],["Jack Rudoni","LCM"],["Ephron Mason-Clark","RST"],["Taiwo Awoniyi","LST"]]),
    }
  },
  {
    date: "2026-09-05", home: "Nottingham Forest", away: "Tottenham Hotspur", teams: {
      "Nottingham Forest": team("3-4-2-1", [["Matz Sels","GK"],["Nikola Milenkovic","RCB"],["Jair Cunha","CB"],["Murillo","LCB"],["Neco Williams","RWB"],["Xaver Schlager","RCM"],["James McAtee","LCM"],["Neco Williams","LWB"],["Morgan Gibbs-White","RAM"],["Dan Ndoye","LAM"],["Igor Jesus","ST"]]),
      "Tottenham Hotspur": team("4-2-3-1", [["Antonin Kinsky","GK"],["Archie Gray","RB"],["Jan Paul van Hecke","RCB"],["Micky van de Ven","LCB"],["Robertson","LB"],["Sandro Tonali","RDM"],["Rodrigo Bentancur","LDM"],["Pedro Porro","RW"],["Mateus Fernandes","CAM"],["Mathys Tel","LW"],["Omar Marmoush","ST"]]),
    }
  },
  {
    date: "2026-09-05", home: "Hull City", away: "Aston Villa", teams: {
      "Hull City": team("3-4-2-1", [["Konstantinos Tzolakis","GK"],["Semi Ajayi","RCB"],["John Egan","CB"],["Nobel Mendy","LCB"],["Lewie Coyle","RWB"],["Regan Slater","RCM"],["Tim Iroegbunam","LCM"],["Ryan Giles","LWB"],["Mohamed Belloumi","RAM"],["Elliot Stroud","LAM"],["Oli McBurnie","ST"]], "Sports Mole predicted XI · 3 Sep 2026"),
      "Aston Villa": team("4-2-3-1", [["Zion Suzuki","GK"],["Matty Cash","RB"],["Victor Lindelof","RCB"],["Pau Torres","LCB"],["Matteo Ruggeri","LB"],["Boubacar Kamara","RDM"],["Leon Goretzka","LDM"],["John McGinn","RW"],["Emiliano Buendia","CAM"],["Ibrahim Mbaye","LW"],["Nicolas Jackson","ST"]], "Sports Mole predicted XI · 3 Sep 2026"),
    }
  },
  {
    date: "2026-09-06", home: "Everton", away: "Manchester United", teams: {
      Everton: team("4-2-3-1", [["Jordan Pickford","GK"],["Jake O'Brien","RB"],["James Tarkowski","RCB"],["Jarrad Branthwaite","LCB"],["Vitalii Mykolenko","LB"],["James Garner","RDM"],["Harrison Armstrong","LDM"],["Brennan Johnson","RW"],["Kiernan Dewsbury-Hall","CAM"],["Jack Grealish","LW"],["Thierno Barry","ST"]]),
      "Manchester United": team("4-2-3-1", [["Senne Lammens","GK"],["Diogo Dalot","RB"],["Harry Maguire","RCB"],["Lisandro Martinez","LCB"],["Luke Shaw","LB"],["Kobbie Mainoo","RDM"],["Youri Tielemans","LDM"],["Bryan Mbeumo","RW"],["Bruno Fernandes","CAM"],["Marcus Rashford","LW"],["Matheus Cunha","ST"]]),
    }
  },
  {
    date: "2026-09-06", home: "Arsenal", away: "Chelsea", teams: {
      Arsenal: team("4-2-3-1", [["David Raya","GK"],["Ben White","RB"],["Ezri Konsa","RCB"],["Gabriel Magalhaes","LCB"],["Riccardo Calafiori","LB"],["Myles Lewis-Skelly","RDM"],["Declan Rice","LDM"],["Bukayo Saka","RW"],["Martin Odegaard","CAM"],["Christos Tzolis","LW"],["Kai Havertz","ST"]]),
      Chelsea: team("3-4-2-1", [["Emiliano Martinez","GK"],["Maxence Lacroix","RCB"],["Levi Colwill","CB"],["Wesley Fofana","LCB"],["Reece James","RWB"],["Malo Gusto","RCM"],["Romeo Lavia","LCM"],["Jorrel Hato","LWB"],["Morgan Rogers","RAM"],["Cole Palmer","LAM"],["Joao Pedro","ST"]]),
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
