function codeToChar(code) { // Accepts character code, returns character
	return String.fromCharCode(code);
}
function charToCode(char) { // Accepts character, returns character code
	return char.charCodeAt(0);
}
function stringToCodes(string) { // Accepts a string of characters, returns an array of character codes
  let codeArray = [];
  for(let i=0; i<string.length; i++) {
    let charCode = charToCode(string[i]);
    codeArray.push(charCode);
  }
  return codeArray;
}

function numToBinaryStr(num) { // Accepts an integer, returns a binary string (minimum length)
	return num.toString(2);
}

function binaryToDec(binaryString) { // Accepts a binary string, returns an integer
	return parseInt(binaryString, 2);
}

function codesToBinary(codeArray) { // Accepts an array of character codes, returns an array of binary bytes (strings)
	let binaryArray = [];
	for(let i=0; i<codeArray.length; i++) {
		const binaryNum = numToBinaryStr(codeArray[i]);
		const paddingLength = 8 - binaryNum.length;
		const padding = '0'.repeat(paddingLength > 0 ? paddingLength : 0);
		
		binaryArray.push(padding + binaryNum);
	}
	return binaryArray;
}

function strToBinaryStr(string, separator = ' ') { // Accepts a text string, returns a string of bytes of binary separated by the separator, default is a space
	const codes = stringToCodes(string);
	const binaryArray = codesToBinary(codes);
	return binaryArray.join(separator);
}

function binaryArrayToStr(binaryArray) { // Accepts an array of binary strings, returrns a string of text
	let string = '';
	for(let i=0; i<binaryArray.length; i++) {
		const charCode = binaryToDec(binaryArray[i]);
		const char = codeToChar(charCode);
		string += char;
	}
	return string;
}

function binaryStrToBinaryArray(binaryString, separator = ' ') { // Accepts a string of binary bytes separated by the separator, returns an array of binary strings
	return binaryString.split(separator);
}

function binaryStrToStr(binaryStr, separator = ' ') { // Accepts a string of binary separated by the separator, returns a string of text
	const binaryArray = binaryStrToBinaryArray(binaryStr, separator);
	const string = binaryArrayToStr(binaryArray);
	return string;
}

console.log(strToBinaryStr('Hello world!')); // Convert text to binary
console.log(binaryStrToStr('01001000 01100101 01101100 01101100 01101111 00100000 01110111 01101111 01110010 01101100 01100100 00100001')); // Convert binary to text
