const escapeFilename = (filename: string) => {
    return filename.replace(/[\/\*\\\:|\?<>"]/gi, "");
};

export default escapeFilename;
