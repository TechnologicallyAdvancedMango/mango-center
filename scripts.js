//Get alerts checkbox status
var alertsCheckboxBYID = document.getElementById("alertsCheckbox");
//Starting values
var devID = "Temporarily Disabled";
var devID2 = "Temporarily Disabled"
var superAutoclickerState = false;
var isAuthorized = false;
var autoClickerSpeed = 100;
var autoClickerHasBeenBought = false;
var autoBuyHasBeenBought = false;
var multiplierCost = BigInt(15);
var multiplier = BigInt(1);
var clicks = BigInt(1);
var doAlerts = alertsCheckboxBYID.checked;
var mouseMoved = false;

//Devtools enabled in URL
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

if(urlParams.get('devtools') === true) {
        isAuthorized = true;
} else { 
        isAuthorized = false
}
        //Achievements here
var achievements = [
  { name: "First Click", unlocked: false, condition: function() { return clicks >= 1; } },
  { name: "Hundred Clicks", unlocked: false, condition: function() { return clicks >= 100; } },
  { name: "Sliced Mango", unlocked: false, condition: function() { return clicks >= 1000; } },
  { name: "Six Figures", unlocked: false, condition: function() { return clicks >= 100000; } },
  { name: "Diced Mango", unlocked: false, condition: function() { return clicks >= 1000000; } },
  { name: "Mr. Beast", unlocked: false, condition: function() { return clicks >= 500000000; } },

];
// Check if the user already has an ID
if (!localStorage.getItem('userID')) {
    // If not, generate a new ID
    var userID = 'user-' + Math.random().toString(36).substr(2, 16);
    // Store the ID in localStorage
    localStorage.setItem('userID', userID);
}

// Now, you can retrieve the ID whenever you need it
var userID = localStorage.getItem('userID');
console.log(userID); // This will output the user's ID

function loadClicks() {
    // Retrieve the clicks from localStorage
    let savedClicks = localStorage.getItem('clicks');
    if (savedClicks) {
        clicks = Number(savedClicks);
    } else {
        localStorage.setItem('clicks', clicks);
    }
}

function loadMultiplier() {
    // Retrieve the multiplier from localStorage
    let savedMultiplier = localStorage.getItem('multiplier');
    if (savedMultiplier) {
        multiplier = Number(savedMultiplier);
    }
}

function loadAutoclickerBought() {
    // Retrieve the multiplier from localStorage
    let savedAutoclickerBought = localStorage.getItem('autoclickerBought') === 'true';
    if (savedAutoclickerBought) {
        autoClickerHasBeenBought = savedAutoclickerBought
    }
}

function loadMultiplierCost() {
    // Retrieve the multiplierCost from localStorage
    let savedMultiplierCost = localStorage.getItem('multiplierCost');
    if (savedMultiplierCost) {
        multiplierCost = Number(savedMultiplierCost);
    }
}


let prevAutoClickerSpeed;
function superAutoclicker() {
    if(autoClickerHasBeenBought == true) {
    if(superAutoclickerState == false) {
        prevAutoClickerSpeed = autoClickerSpeed;
        autoClickerSpeed = 1;
        superAutoclickerState = true;
    } else {
        autoClickerSpeed = prevAutoClickerSpeed;
        superAutoclickerState = false;
    }
} else {
        return;
}
}

function checkAchievements() {
  for (var i = 0; i < achievements.length; i++) {
    var achievement = achievements[i];
    if (!achievement.unlocked && achievement.condition()) {
      achievement.unlocked = true;
     if(doAlerts) {
      alert("Achievement unlocked: " + achievement.name);
        //used to halve multiplier cost and double autoclicker speed. Caused too many problems.
     }
    }
  }
}

// Check if the user's ID matches the dev ID
if (userID === devID || userID === devID2) {
    // If it does, give them access to the devtools
   document.getElementById("devTools").style.display = "block";
}

 // Function to check the secret code

function updateGame() {
  updateContent();
  checkAchievements();
  updateAchievementsDisplay();
  multiplierCost = Math.floor(multiplierCost);
  clicks = Math.floor(clicks);
  doAlerts = alertsCheckboxBYID.checked;
 if(autoClickerHasBeenBought === true) {
  shopAutoclicker.textContent = "Autoclicker Purchased";
            shopAutoclicker.className = "acp1";
 } else {
  shopAutoclicker.className = "ac";
  shopAutoclicker.textontent = "Buy Autoclicker | Cost: 1000";
 }
  localStorage.setItem('clicks', clicks.toString());
   localStorage.setItem('multiplier', multiplier.toString());
    localStorage.setItem('multiplierCost', multiplierCost.toString());
    localStorage.setItem('autoclickerBought', autoClickerHasBeenBought.toString());
}

  function playSound(soundUrl) {
    var audio = new Audio(soundUrl);
    audio.play();
  }

      function updateAchievementsDisplay() {
  var achievementsDiv = document.getElementById("achievements");
  // Clear the current achievements display
  achievementsDiv.innerHTML = "<h2>Achievements</h2>";

  // Add each achievement to the display
  for (var i = 0; i < achievements.length; i++) {
    var achievement = achievements[i];
    var achievementElement = document.createElement("p");
    achievementElement.textContent = achievement.name + ": " + (achievement.unlocked ? "Unlocked" : "Locked");
    achievementsDiv.appendChild(achievementElement);
  }
}
      function updateContent() {
        display.textContent = "Clicks: " + clicks;
        displayMultiplier.textContent = "Multiplier: " + multiplier;
        shopMultiplier.textContent = "Buy Multiplier | Cost: " + multiplierCost
        userId.textContent = userID;

    }
   function clickHandler() {
    var display = document.getElementById("display");
        clicks = clicks + 1 * multiplier;
        updateGame();
   }
    function buyMultipliers() {
  if (clicks >= multiplierCost) {
    multiplier += 1;
    clicks -= multiplierCost;
    multiplierCost = multiplierCost * 1.2
    multiplierCost = Math.floor(multiplierCost);
    updateGame();
  } else {
          if(doAlerts) {
      alert("You cannot afford the multiplier.");
          }
  }
}

     function buyAllMultipliers() {
        while(clicks >= multiplierCost) {
        clicks = clicks - multiplierCost;
        multiplier++;
        multiplierCost = multiplierCost * 1.2
        updateGame();
     }
         updateGame();
    }
//Autoclicker purchase and upgrade
      function buyAutoclicker() {
        if(!autoClickerHasBeenBought && clicks >= 1000) {
         autoClickerHasBeenBought = true;
            clicks = clicks - 1000;
            shopAutoclicker.textContent = "Autoclicker Purchased"
            shopAutoclicker.className = "acp1";
        } updateGame()
    }

      function autoClicker() {
    if(autoClickerHasBeenBought == true) {
        clickHandler();
    }
    setTimeout(autoClicker, autoClickerSpeed); // Always set the timeout
}
        function autoBuy() {
            var checkbox = document.getElementById("autoBuyCheckbox");
            if(checkbox.checked) {
            if(autoBuyHasBeenBought && clicks >= multiplierCost) {
                buyMultipliers();
                }
            }
        } setInterval(autoBuy, 200); // Always set the interval
  
    function resetGame() {
      if(confirm("Are you sure you want to restart your game? (Wipes game file)")) {
      superAutoclickerState = false;
      isAuthorized = false;
      autoClickerSpeed = 100;
      autoClickerHasBeenBought = false;
      autoBuyHasBeenBought = false;
      multiplierCost = 15n;
    multiplier = 1n;
   clicks = 0n;
localStorage.setItem('clicks', clicks.toString());
   localStorage.setItem('multiplier', multiplier.toString());
    localStorage.setItem('multiplierCost', multiplierCost.toString());
    localStorage.setItem('autoClickerBought', autoClickerHasBeenBought.toString());
    shopAutoclicker.className = "acp1"
  location.reload();
      };
    };
 document.body.addEventListener('mousemove', function(e) {
    if(!mouseMoved) {
        updateGame();
    }
});
loadClicks();
loadMultiplier();
loadMultiplierCost();
loadAutoclickerBought();
autoClicker(); // Start the loop
autoBuy();// Start the loop
    updateGame();
