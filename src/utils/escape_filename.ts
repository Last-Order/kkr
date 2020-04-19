const escapeFilename = (filename: string) => {
    return filename.replace(/[\/\*\\\:|\?<>]/ig, "");
}

export default escapeFilename;