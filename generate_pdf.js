const puppeteer = require('puppeteer');
const path = require('path');

async function generatePDF() {
    console.log('Starting PDF generation...');
    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        const htmlPath = path.join(__dirname, 'sales_brochure.html');
        console.log(`Loading HTML from: ${htmlPath}`);
        
        await page.goto(`file://${htmlPath}`, { 
            waitUntil: 'networkidle0' 
        });

        const outputPath = path.join(__dirname, 'ApexTime_Cloud_Brochure.pdf');
        
        await page.pdf({
            path: outputPath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '0px',
                right: '0px',
                bottom: '0px',
                left: '0px'
            }
        });

        console.log(`Successfully generated PDF at: ${outputPath}`);
        await browser.close();
    } catch (error) {
        console.error('Error generating PDF:', error);
    }
}

generatePDF();
