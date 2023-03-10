const prompt = require('prompt-sync')({sigint: true});
const fetch = require('node-fetch');
const msgpack = require('msgpack-lite');
const aesjs = require('aes-js');
const PDFDocument = require('pdf-lib').PDFDocument;
const fs = require('fs');
const sanitize = require("sanitize-filename");

let key = new Uint8Array([30, 0, 184, 152, 115, 19, 157, 33, 4, 237, 80, 26, 139, 248, 104, 155]);

async function downloadAndDecryptFile(url) { 
    return new Promise(async (resolve, reject) => {
        let file = await fetch(url, {method: "GET"}).then(res => res.buffer());

        try {
            let header = msgpack.decode(file.slice(0, 256));
            console.log(header);
            let firstPart = file.slice(256, header.start);
            let secondPart = new Uint8Array(file.slice(header.start));
            var aesCbc = new aesjs.ModeOfOperation.cbc(key, firstPart.slice(0, 16));
            var decryptedFirstPart = aesCbc.decrypt(firstPart.slice(16));

            for(let i=16; i > 0; i--){
                if (decryptedFirstPart.slice(decryptedFirstPart.length-i).every(e=>e==i)) {
                    decryptedFirstPart = decryptedFirstPart.slice(0, decryptedFirstPart.length-i);
                    break;
                }
            }

            let result = new Uint8Array(decryptedFirstPart.length + secondPart.length);
            result.set(decryptedFirstPart);
            result.set(secondPart, decryptedFirstPart.length);
            resolve(result);
        } catch (e) {
            reject({e, file})
        }
    });
}

(async () => {
    //Incollare qui il cookie di sessione.
    let user = await fetch("https://www.bsmart.it/api/v5/user", {headers: {cookie:'_bsw_session_v1_production=VPE2i7pExcPF7x%2BFxBfi3tZ0ErzZyo%2Bv7z%2B1D846gWknNY71pyLxnxPDZ2MqzNLqSc8Qp07edvUwXCa6C%2Fm1R%2FFlvEeDe8i18vNeSo4iLS6VP635pzrrJ4%2BPLeobNa4uMiGZlWnCGF%2B06ymqwiKwS0xSBtN9cZPJMCxkZTcBGOxp4E81dIpvow1nJezN9B7rPN81dG8ioXxXtjq%2BMAwpQAWcznuybscqFUC1cqoYSThai89s%2BoMxkKR6WJBspu%2FLVBmpcJVHKBnwIFksGo8RnvfezYwH7lys6uNk6ifD1kVRUAdcdxceqMjGVyXnKNZctZegRDBTI08KgsJbdd%2BSs462gAKzcMDmwuvxX%2FlopHys9UDGaC10faki80PvI7EaEfAcC%2BQHk3gI1BuTf7SLVt1bcyDSb8OqhBHYa%2BsenvgRrr%2BgOtoh6F6M77QPvtHP--PwgjFICQv6xjrula--7sVkaHqgQD1WtVRewYeStw%3D%3D'}});

    if (user.status != 200) {
        console.log("Bad or expired cookie!");
        return;
    }

    user = await user.json();
    let headers = {"auth_token": user.auth_token};
    let books = await fetch(`https://www.bsmart.it/api/v6/books?page_thumb_size=medium&per_page=25000`, {headers}).then(res => res.json());

    if (books.length == 0) {
        console.log('No books in your library!');
    } else {
        console.log("Book list:");
        let i=0;
        books.forEach((b) => {
            console.log(`${b.id} -> ${b.title}`);
        });
    }

    let bookId = prompt(`Insert ID${(books.length == 0 ? " manually" : "")}:`);
	let book = await fetch(`https://www.bsmart.it/api/v6/books/by_book_id/${bookId}`, {headers});
    console.log("Starting to download...");

    if (book.status != 200) {
        console.log("Invalid book ID!");
        return;
    }

    book = await book.json();
    let info = [];
    let page = 1;
    while (true) {
        let tempInfo = await fetch(`https://api.bsmart.it/api/v5/books/${book.id}/${book.current_edition.revision}/resources?per_page=500&page=${page}`, {headers}).then(res => res.json());
        info = info.concat(tempInfo);
        if (tempInfo.length < 500) break;
        page++;
    }
    
    console.log("Downloading pages...");
    const outputPdf = await PDFDocument.create()

    for (i = 0; i < info.length; i++) {
        for (j = 0; j < info[i].assets.length; j++) {
            console.log(`Progress ${(i/info.length * 100).toFixed(2)}%...`);

            if (info[i].assets[j].use != "page_pdf") continue;
            let pageData = await downloadAndDecryptFile(info[i].assets[j].url).catch((e) => {console.log("Error Downloading page", e, i, j, info[i].assets[j].url)});
            // if (md5(pageData) != info[i].assets[j].url) console.log("Missmatching md5 hash", i, j, info[i].assets[j].url)
            //fs.writeFile(`temp/${i}-${j}.pdf`, pageData, (e)=>{});
            const page = await PDFDocument.load(pageData);
            const [firstDonorPage] = await outputPdf.copyPages(page, [0]);
            outputPdf.addPage(firstDonorPage);
        }
    }

    //fs.writeFile(prompt("Input file name:") + ".pdf", await outputPdf.save(), (e)=>{});
    fs.writeFile(sanitize(book.id + " - " + book.title + ".pdf"), await outputPdf.save(), (e)=>{});
    console.log(`Saved ${book.id}-${book.title}.pdf!`);

})();

/*(async ()=> {
    fs.writeFile("test.pdf", await downloadAndDecryptFile("https://s3-eu-west-1.amazonaws.com/dea.bsmart.it/0/9/092662be7c3701b1c596057205fc8a7e"), (e)=>{});
})()*/
